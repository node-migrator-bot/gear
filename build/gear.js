var gear = gear || {};gear.tasks = gear.tasks || {};gear.vendor = gear.vendor || {};/*global setTimeout: false, console: false */
(function () {

    var async = {};

    // global on the server, window in the browser
    var root = this,
        previous_async = root.async;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = async;
    }
    else {
        root.async = async;
    }

    async.noConflict = function () {
        root.async = previous_async;
        return async;
    };

    //// cross-browser compatiblity functions ////

    var _forEach = function (arr, iterator) {
        if (arr.forEach) {
            return arr.forEach(iterator);
        }
        for (var i = 0; i < arr.length; i += 1) {
            iterator(arr[i], i, arr);
        }
    };

    var _map = function (arr, iterator) {
        if (arr.map) {
            return arr.map(iterator);
        }
        var results = [];
        _forEach(arr, function (x, i, a) {
            results.push(iterator(x, i, a));
        });
        return results;
    };

    var _reduce = function (arr, iterator, memo) {
        if (arr.reduce) {
            return arr.reduce(iterator, memo);
        }
        _forEach(arr, function (x, i, a) {
            memo = iterator(memo, x, i, a);
        });
        return memo;
    };

    var _keys = function (obj) {
        if (Object.keys) {
            return Object.keys(obj);
        }
        var keys = [];
        for (var k in obj) {
            if (obj.hasOwnProperty(k)) {
                keys.push(k);
            }
        }
        return keys;
    };

    //// exported async module functions ////

    //// nextTick implementation with browser-compatible fallback ////
    if (typeof process === 'undefined' || !(process.nextTick)) {
        async.nextTick = function (fn) {
            setTimeout(fn, 0);
        };
    }
    else {
        async.nextTick = process.nextTick;
    }

    async.forEach = function (arr, iterator, callback) {
        callback = callback || function () {};
        if (!arr.length) {
            return callback();
        }
        var completed = 0;
        _forEach(arr, function (x) {
            iterator(x, function (err) {
                if (err) {
                    callback(err);
                    callback = function () {};
                }
                else {
                    completed += 1;
                    if (completed === arr.length) {
                        callback(null);
                    }
                }
            });
        });
    };

    async.forEachSeries = function (arr, iterator, callback) {
        callback = callback || function () {};
        if (!arr.length) {
            return callback();
        }
        var completed = 0;
        var iterate = function () {
            iterator(arr[completed], function (err) {
                if (err) {
                    callback(err);
                    callback = function () {};
                }
                else {
                    completed += 1;
                    if (completed === arr.length) {
                        callback(null);
                    }
                    else {
                        iterate();
                    }
                }
            });
        };
        iterate();
    };

    async.forEachLimit = function (arr, limit, iterator, callback) {
        callback = callback || function () {};
        if (!arr.length || limit <= 0) {
            return callback();
        }
        var completed = 0;
        var started = 0;
        var running = 0;

        (function replenish () {
            if (completed === arr.length) {
                return callback();
            }

            while (running < limit && started < arr.length) {
                started += 1;
                running += 1;
                iterator(arr[started - 1], function (err) {
                    if (err) {
                        callback(err);
                        callback = function () {};
                    }
                    else {
                        completed += 1;
                        running -= 1;
                        if (completed === arr.length) {
                            callback();
                        }
                        else {
                            replenish();
                        }
                    }
                });
            }
        })();
    };


    var doParallel = function (fn) {
        return function () {
            var args = Array.prototype.slice.call(arguments);
            return fn.apply(null, [async.forEach].concat(args));
        };
    };
    var doSeries = function (fn) {
        return function () {
            var args = Array.prototype.slice.call(arguments);
            return fn.apply(null, [async.forEachSeries].concat(args));
        };
    };


    var _asyncMap = function (eachfn, arr, iterator, callback) {
        var results = [];
        arr = _map(arr, function (x, i) {
            return {index: i, value: x};
        });
        eachfn(arr, function (x, callback) {
            iterator(x.value, function (err, v) {
                results[x.index] = v;
                callback(err);
            });
        }, function (err) {
            callback(err, results);
        });
    };
    async.map = doParallel(_asyncMap);
    async.mapSeries = doSeries(_asyncMap);


    // reduce only has a series version, as doing reduce in parallel won't
    // work in many situations.
    async.reduce = function (arr, memo, iterator, callback) {
        async.forEachSeries(arr, function (x, callback) {
            iterator(memo, x, function (err, v) {
                memo = v;
                callback(err);
            });
        }, function (err) {
            callback(err, memo);
        });
    };
    // inject alias
    async.inject = async.reduce;
    // foldl alias
    async.foldl = async.reduce;

    async.reduceRight = function (arr, memo, iterator, callback) {
        var reversed = _map(arr, function (x) {
            return x;
        }).reverse();
        async.reduce(reversed, memo, iterator, callback);
    };
    // foldr alias
    async.foldr = async.reduceRight;

    var _filter = function (eachfn, arr, iterator, callback) {
        var results = [];
        arr = _map(arr, function (x, i) {
            return {index: i, value: x};
        });
        eachfn(arr, function (x, callback) {
            iterator(x.value, function (v) {
                if (v) {
                    results.push(x);
                }
                callback();
            });
        }, function (err) {
            callback(_map(results.sort(function (a, b) {
                return a.index - b.index;
            }), function (x) {
                return x.value;
            }));
        });
    };
    async.filter = doParallel(_filter);
    async.filterSeries = doSeries(_filter);
    // select alias
    async.select = async.filter;
    async.selectSeries = async.filterSeries;

    var _reject = function (eachfn, arr, iterator, callback) {
        var results = [];
        arr = _map(arr, function (x, i) {
            return {index: i, value: x};
        });
        eachfn(arr, function (x, callback) {
            iterator(x.value, function (v) {
                if (!v) {
                    results.push(x);
                }
                callback();
            });
        }, function (err) {
            callback(_map(results.sort(function (a, b) {
                return a.index - b.index;
            }), function (x) {
                return x.value;
            }));
        });
    };
    async.reject = doParallel(_reject);
    async.rejectSeries = doSeries(_reject);

    var _detect = function (eachfn, arr, iterator, main_callback) {
        eachfn(arr, function (x, callback) {
            iterator(x, function (result) {
                if (result) {
                    main_callback(x);
                    main_callback = function () {};
                }
                else {
                    callback();
                }
            });
        }, function (err) {
            main_callback();
        });
    };
    async.detect = doParallel(_detect);
    async.detectSeries = doSeries(_detect);

    async.some = function (arr, iterator, main_callback) {
        async.forEach(arr, function (x, callback) {
            iterator(x, function (v) {
                if (v) {
                    main_callback(true);
                    main_callback = function () {};
                }
                callback();
            });
        }, function (err) {
            main_callback(false);
        });
    };
    // any alias
    async.any = async.some;

    async.every = function (arr, iterator, main_callback) {
        async.forEach(arr, function (x, callback) {
            iterator(x, function (v) {
                if (!v) {
                    main_callback(false);
                    main_callback = function () {};
                }
                callback();
            });
        }, function (err) {
            main_callback(true);
        });
    };
    // all alias
    async.all = async.every;

    async.sortBy = function (arr, iterator, callback) {
        async.map(arr, function (x, callback) {
            iterator(x, function (err, criteria) {
                if (err) {
                    callback(err);
                }
                else {
                    callback(null, {value: x, criteria: criteria});
                }
            });
        }, function (err, results) {
            if (err) {
                return callback(err);
            }
            else {
                var fn = function (left, right) {
                    var a = left.criteria, b = right.criteria;
                    return a < b ? -1 : a > b ? 1 : 0;
                };
                callback(null, _map(results.sort(fn), function (x) {
                    return x.value;
                }));
            }
        });
    };

    async.auto = function (tasks, callback) {
        callback = callback || function () {};
        var keys = _keys(tasks);
        if (!keys.length) {
            return callback(null);
        }

        var results = {};

        var listeners = [];
        var addListener = function (fn) {
            listeners.unshift(fn);
        };
        var removeListener = function (fn) {
            for (var i = 0; i < listeners.length; i += 1) {
                if (listeners[i] === fn) {
                    listeners.splice(i, 1);
                    return;
                }
            }
        };
        var taskComplete = function () {
            _forEach(listeners.slice(0), function (fn) {
                fn();
            });
        };

        addListener(function () {
            if (_keys(results).length === keys.length) {
                callback(null, results);
                callback = function () {};
            }
        });

        _forEach(keys, function (k) {
            var task = (tasks[k] instanceof Function) ? [tasks[k]]: tasks[k];
            var taskCallback = function (err) {
                if (err) {
                    callback(err);
                    // stop subsequent errors hitting callback multiple times
                    callback = function () {};
                }
                else {
                    var args = Array.prototype.slice.call(arguments, 1);
                    if (args.length <= 1) {
                        args = args[0];
                    }
                    results[k] = args;
                    taskComplete();
                }
            };
            var requires = task.slice(0, Math.abs(task.length - 1)) || [];
            var ready = function () {
                return _reduce(requires, function (a, x) {
                    return (a && results.hasOwnProperty(x));
                }, true) && !results.hasOwnProperty(k);
            };
            if (ready()) {
                task[task.length - 1](taskCallback, results);
            }
            else {
                var listener = function () {
                    if (ready()) {
                        removeListener(listener);
                        task[task.length - 1](taskCallback, results);
                    }
                };
                addListener(listener);
            }
        });
    };

    async.waterfall = function (tasks, callback) {
        callback = callback || function () {};
        if (!tasks.length) {
            return callback();
        }
        var wrapIterator = function (iterator) {
            return function (err) {
                if (err) {
                    callback(err);
                    callback = function () {};
                }
                else {
                    var args = Array.prototype.slice.call(arguments, 1);
                    var next = iterator.next();
                    if (next) {
                        args.push(wrapIterator(next));
                    }
                    else {
                        args.push(callback);
                    }
                    async.nextTick(function () {
                        iterator.apply(null, args);
                    });
                }
            };
        };
        wrapIterator(async.iterator(tasks))();
    };

    async.parallel = function (tasks, callback) {
        callback = callback || function () {};
        if (tasks.constructor === Array) {
            async.map(tasks, function (fn, callback) {
                if (fn) {
                    fn(function (err) {
                        var args = Array.prototype.slice.call(arguments, 1);
                        if (args.length <= 1) {
                            args = args[0];
                        }
                        callback.call(null, err, args);
                    });
                }
            }, callback);
        }
        else {
            var results = {};
            async.forEach(_keys(tasks), function (k, callback) {
                tasks[k](function (err) {
                    var args = Array.prototype.slice.call(arguments, 1);
                    if (args.length <= 1) {
                        args = args[0];
                    }
                    results[k] = args;
                    callback(err);
                });
            }, function (err) {
                callback(err, results);
            });
        }
    };

    async.series = function (tasks, callback) {
        callback = callback || function () {};
        if (tasks.constructor === Array) {
            async.mapSeries(tasks, function (fn, callback) {
                if (fn) {
                    fn(function (err) {
                        var args = Array.prototype.slice.call(arguments, 1);
                        if (args.length <= 1) {
                            args = args[0];
                        }
                        callback.call(null, err, args);
                    });
                }
            }, callback);
        }
        else {
            var results = {};
            async.forEachSeries(_keys(tasks), function (k, callback) {
                tasks[k](function (err) {
                    var args = Array.prototype.slice.call(arguments, 1);
                    if (args.length <= 1) {
                        args = args[0];
                    }
                    results[k] = args;
                    callback(err);
                });
            }, function (err) {
                callback(err, results);
            });
        }
    };

    async.iterator = function (tasks) {
        var makeCallback = function (index) {
            var fn = function () {
                if (tasks.length) {
                    tasks[index].apply(null, arguments);
                }
                return fn.next();
            };
            fn.next = function () {
                return (index < tasks.length - 1) ? makeCallback(index + 1): null;
            };
            return fn;
        };
        return makeCallback(0);
    };

    async.apply = function (fn) {
        var args = Array.prototype.slice.call(arguments, 1);
        return function () {
            return fn.apply(
                null, args.concat(Array.prototype.slice.call(arguments))
            );
        };
    };

    var _concat = function (eachfn, arr, fn, callback) {
        var r = [];
        eachfn(arr, function (x, cb) {
            fn(x, function (err, y) {
                r = r.concat(y || []);
                cb(err);
            });
        }, function (err) {
            callback(err, r);
        });
    };
    async.concat = doParallel(_concat);
    async.concatSeries = doSeries(_concat);

    async.whilst = function (test, iterator, callback) {
        if (test()) {
            iterator(function (err) {
                if (err) {
                    return callback(err);
                }
                async.whilst(test, iterator, callback);
            });
        }
        else {
            callback();
        }
    };

    async.until = function (test, iterator, callback) {
        if (!test()) {
            iterator(function (err) {
                if (err) {
                    return callback(err);
                }
                async.until(test, iterator, callback);
            });
        }
        else {
            callback();
        }
    };

    async.queue = function (worker, concurrency) {
        var workers = 0;
        var q = {
            tasks: [],
            concurrency: concurrency,
            saturated: null,
            empty: null,
            drain: null,
            push: function (data, callback) {
                if(data.constructor !== Array) {
                    data = [data];
                }
                _forEach(data, function(task) {
                    q.tasks.push({
                        data: task,
                        callback: typeof callback === 'function' ? callback : null
                    });
                    if (q.saturated && q.tasks.length == concurrency) {
                        q.saturated();
                    }
                    async.nextTick(q.process);
                });
            },
            process: function () {
                if (workers < q.concurrency && q.tasks.length) {
                    var task = q.tasks.shift();
                    if(q.empty && q.tasks.length == 0) q.empty();
                    workers += 1;
                    worker(task.data, function () {
                        workers -= 1;
                        if (task.callback) {
                            task.callback.apply(task, arguments);
                        }
                        if(q.drain && q.tasks.length + workers == 0) q.drain();
                        q.process();
                    });
                }
            },
            length: function () {
                return q.tasks.length;
            },
            running: function () {
                return workers;
            }
        };
        return q;
    };

    var _console_fn = function (name) {
        return function (fn) {
            var args = Array.prototype.slice.call(arguments, 1);
            fn.apply(null, args.concat([function (err) {
                var args = Array.prototype.slice.call(arguments, 1);
                if (typeof console !== 'undefined') {
                    if (err) {
                        if (console.error) {
                            console.error(err);
                        }
                    }
                    else if (console[name]) {
                        _forEach(args, function (x) {
                            console[name](x);
                        });
                    }
                }
            }]));
        };
    };
    async.log = _console_fn('log');
    async.dir = _console_fn('dir');
    /*async.info = _console_fn('info');
    async.warn = _console_fn('warn');
    async.error = _console_fn('error');*/

    async.memoize = function (fn, hasher) {
        var memo = {};
        var queues = {};
        hasher = hasher || function (x) {
            return x;
        };
        var memoized = function () {
            var args = Array.prototype.slice.call(arguments);
            var callback = args.pop();
            var key = hasher.apply(null, args);
            if (key in memo) {
                callback.apply(null, memo[key]);
            }
            else if (key in queues) {
                queues[key].push(callback);
            }
            else {
                queues[key] = [callback];
                fn.apply(null, args.concat([function () {
                    memo[key] = arguments;
                    var q = queues[key];
                    delete queues[key];
                    for (var i = 0, l = q.length; i < l; i++) {
                      q[i].apply(null, arguments);
                    }
                }]));
            }
        };
        memoized.unmemoized = fn;
        return memoized;
    };

    async.unmemoize = function (fn) {
      return function () {
        return (fn.unmemoized || fn).apply(null, arguments);
      };
    };

}).call(gear.vendor);/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
(function(exports) {
     /*
     * Blob
     *
     * Loosely based on W3C Blob:
     * http://www.w3.org/TR/FileAPI/#dfn-Blob
     * https://developer.mozilla.org/en/DOM/Blob
     *
     * @param parts {String|Blob|Array} Create new Blob from String/Blob or Array of String/Blob.
     */
    var Blob = exports.Blob = function Blob(parts, properties) {
        if (parts === undefined) {
            parts = [];
        } else {
            if (!Array.isArray(parts)) {
                parts = [parts];
            }
        }

        properties = properties || {};

        var content = '',
            props = {};

        parts.forEach(function(part) {
            content += part;

            var attr;
            if (typeof part === 'object') {
                for (attr in part) {
                    props[attr] = part[attr];
                }
            }
        });

        var attr;
        for (attr in properties) {
            props[attr] = properties[attr];
        }

        Object.defineProperty(this, '_content', {get: function() {
            return content;
        }});

        Object.defineProperty(this, 'properties', {get: function() {
            return props;
        }});
    };

    Blob.prototype.toString = function() {
        return this._content;
    };

    var readFile = {
        server: function(name, encoding, callback) {
            var fs = require('fs');
            fs.readFile(name, encoding, function(err, data) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, new Blob(data, {name: name}));
                }
            });
        },
        client: function(name, encoding, callback) {
            if (name in localStorage) {
                callback(null, new Blob(localStorage[name], {name: name}));
            } else {
                callback('localStorage has no item ' + name);
            }
        }
    };

    Blob.readFile = Blob.prototype.readFile = (typeof require === 'undefined') ? readFile.client : readFile.server;

    var writeFile = {
        server: function(name, blob, encoding, callback) {
            var fs = require('fs'),
                path = require('path'),
                mkdirp = require('mkdirp').mkdirp,
                Crypto = require('crypto');
            
            function writeFile(filename, b) {
                fs.writeFile(filename, b.toString(), function(err) {
                    callback(err, new Blob(b, {name: filename}));
                });
            }

            var dirname = path.resolve(path.dirname(name)),
                checksum;

            if (name.indexOf('{checksum}') > -1) {  // Replace {checksum} with md5 string
                checksum = Crypto.createHash('md5');
                checksum.update(blob.toString());
                name = name.replace('{checksum}', checksum.digest('hex'));
            }

            path.exists(dirname, function(exists) {
                if (!exists) {
                    mkdirp(dirname, '0755', function(err) {
                        if (err) {
                            callback(err);
                        } else {
                            writeFile(name, blob);
                        }
                    });
                }
                else {
                    writeFile(name, blob);
                }
            });
        },
        client: function(name, blob, encoding, callback) {
            localStorage[name] = blob.toString();
            callback(null, new blob.constructor(blob, {name: name}));
        }
    };

    Blob.writeFile = Blob.prototype.writeFile = (typeof require === 'undefined') ? writeFile.client : writeFile.server;
})(typeof exports === 'undefined' ? this.gear : exports);/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
(function(exports) {
    /**
     * Concatenates blobs.
     *
     * @param options {Object} Concat options.
     * @param options.callback {Function} Callback on each blob.
     * @param blobs {Array} Incoming blobs.
     * @param done {Function} Callback on task completion.
     */
    var concat = exports.concat = function concat(options, prev, blob, done) {
        options = options || {};
        done(null, new blob.constructor([prev, options.callback ? options.callback(blob) : blob]));
    };
    concat.type = 'reduce';
})(typeof exports === 'undefined' ? gear.tasks : exports);/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
(function(exports) {
    var Blob = typeof require !== 'undefined' ? require('../blob').Blob : gear.Blob;

    /**
     * Add a blob string.
     *
     * @param index {Integer} Index of blobs.
     * @param blobs {Array} Incoming blobs.
     * @param done {Function} Callback on task completion.
     */
    var load = exports.load = function load(string, done) {
        done(null, new Blob(string));
    };
    load.type = 'append';

    /**
     * Gets a blob.
     *
     * @param index {Integer} Index of blobs.
     * @param blobs {Array} Incoming blobs.
     * @param done {Function} Callback on task completion.
     */
    var get = exports.get = function get(index, blobs, done) {
        done(null, blobs.slice(index, index + 1));
    };
    get.type = 'iterate';

    /**
     * Log a string.
     *
     * @param string {String} String to log.
     * @param blob {Array} Incoming blobs.
     * @param done {Function} Callback on task completion.
     */
    var log = exports.log = function log(string, blobs, done) {
        this._log(string);
        done(null, blobs);
    };
    log.type = 'iterate';

    /**
     * Inspects blobs.
     *
     * @param options {Object} Ignored.
     * @param blob {Object} Incoming blobs.
     * @param done {Function} Callback on task completion.
     */
    var inspect = exports.inspect = function inspect(options, blobs, done) {
        var self = this;
        this._log('INSPECT: ' + blobs.length + (blobs.length > 1 ? ' blobs' : ' blob'));

        blobs.forEach(function(blob, index) {
            self._log(blob.toString());
        });

        done(null, blobs);
    };
    inspect.type = 'iterate';

    /**
     * Do nothing.
     *
     * @param dummy {N/A} N/A.
     * @param blob {Array} Incoming blob.
     * @param done {Function} Callback on task completion.
     */
    var noop = exports.noop = function noop(dummy, blob, done) {
        done(null, blob);
    };
})(typeof exports === 'undefined' ? gear.tasks : exports);/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
(function(exports) {
    var Blob = typeof require !== 'undefined' ? require('../blob').Blob : gear.Blob;

    /**
     * Appends file contents onto queue.
     *
     * @param options {Object} File options or filename.
     * @param options.name {String} Filename to read.
     * @param options.encoding {String} File encoding.
     * @param done {Function} Callback on task completion.
     */
    var read = exports.read = function read(options, done) {
        options = (typeof options === 'string') ? {name: options} : options;
        var encoding = options.encoding || 'utf8';
        Blob.readFile(options.name, encoding, done);
    };
    read.type = 'append';
})(typeof exports === 'undefined' ? gear.tasks : exports);/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
(function(exports) {
    var async = typeof require !== 'undefined' ? require('async') : gear.vendor.async;

    /**
     * Advanced flow execution.
     *
     * @param workflow {String} TODO.
     * @param blob {Object} Incoming blob.
     * @param done {Function} Callback on task completion.
     */
    var tasks = exports.tasks = function tasks(workflow, blobs, done) {
        var item,
            task,
            name,
            requires,
            fn,
            auto = {},
            self = this;

        function runTask(name, options, requires) {
            return function(callback, result) {
                var new_blobs = requires.length ? [] : blobs;
                result = result || [];

                // Concat dependency blobs in order of requires array
                requires.forEach(function(item) {
                    new_blobs = new_blobs.concat(result[item]);
                });

                self._dispatch(name, options, new_blobs, callback);
            };
        }

        for (item in workflow) {
            task = workflow[item].task;

            if (task === undefined) {
                task = ['noop'];
            } else {
                if (!Array.isArray(task)) {
                    task = [task];
                }
            }

            requires = workflow[item].requires;

            if (requires === undefined) {
                requires = [];
            } else {
                if (!Array.isArray(requires)) {
                    requires = [requires];
                }
            }

            fn = runTask(task[0], task[1], requires);
            auto[item] = requires ? requires.concat(fn) : fn;
        }
        
        async.auto(auto, function(err, results) {
            if (err) {
                done(err);
                return;
            }
            
            done(err, results.join ? results.join : []);
        });
    };
    tasks.type = 'iterate';
})(typeof exports === 'undefined' ? gear.tasks : exports);/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
(function(exports) {
    /**
     * Write the blob to disk with an optional checksum in the filename.
     *
     * @param options {Object} Write options or filename.
     * @param options.file {String} Filename to write.
     * @param blob {Object} Incoming blob.
     * @param done {Function} Callback on task completion.
     */
    var write = exports.write = function write(options, blob, done) {
        options = (typeof options === 'string') ? {name: options} : options;
        var encoding = options.encoding || 'utf8';
        blob.writeFile(options.name, blob, encoding, done);
    };
    write.type = 'slice';
})(typeof exports === 'undefined' ? gear.tasks : exports);/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
(function(exports) {
    if (typeof require !== 'undefined') {
        var path = require('path');
    }
    else {
        var default_tasks = this.gear.tasks;
    }
    
    /*
     * Registry - Container for available tasks.
     */
    var Registry = exports.Registry = function Registry(options) {
        var self = this;
        this._tasks = {};

        // Load default tasks
        if (typeof __dirname !== 'undefined') {
            this.load({dirname: __dirname + '/tasks'});
        }
        else if (typeof default_tasks !== 'undefined') {
            this.load({tasks: default_tasks});
        }

        if (options) {
            this.load(options);
        }

        Object.defineProperty(this, 'tasks', {get: function() {
            return Object.keys(self._tasks);
        }});
    };

    Registry.prototype = {
        /*
         * Load tasks from NPM, directory, or file.
         */
        load: function(options) {
            options = options || {};

            if (options.module) {
                this._loadModule(options.module);
            }

            if (options.dirname) {
                this._loadDir(options.dirname);
            }

            if (options.filename) {
                this._loadFile(options.filename);
            }

            if (options.tasks) {
                this._loadTasks(options.tasks);
            }
        },

        _loadModule: function(name) {
            this._loadDir(path.resolve('node_modules', name, 'lib'));
        },

        _loadDir: function(dirname) {
            var fs = require('fs'),
                files = fs.readdirSync(dirname),
                self = this;

            if (!path.existsSync(dirname)) {
                throw new Error('Directory ' + dirname + ' doesn\'t exist');
            }

            files.forEach(function(filename) {
                self._loadFile(path.join(dirname, filename));
            });
        },

        _loadFile: function(filename) {
            if (path.extname(filename) !== '.js') {
                return;
            }

            if (!path.existsSync(filename)) {
                throw new Error('File ' + filename + ' doesn\'t exist');
            }

            this._loadTasks(require(filename));
        },

        _loadTasks: function(tasks) {
            var name;

            for (name in tasks) {
                this._tasks[name] = tasks[name];
            }
        },

        task: function(name) {
            if (!(name in this._tasks)) {
                throw new Error('Task ' + name + ' doesn\'t exist');
            }
            return this._tasks[name];
        }
    };
})(typeof exports === 'undefined' ? this.gear : exports);/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
(function(exports) {
    var async = typeof require !== 'undefined' ? require('async') : this.gear.vendor.async,
        Registry = typeof require !== 'undefined' ? require('./registry').Registry : this.gear.Registry,
        Blob = typeof require !== 'undefined' ? require('./blob').Blob : this.gear.Blob;

    /*
     * Queue
     */
    var Queue = exports.Queue = function Queue(options) {
        var self = this;
        options = options || {};
        this._logger = options.logger || console;
        this._registry = options.registry || new Registry();
        this._queue = [
            function(callback) {
                callback(null, []);
            }
        ];

        // Add registry tasks
        this._registry.tasks.forEach(function(name) {
            self[name] = self.task.bind(self, name);
        });
    };

    Queue.prototype._log = function(message) {
        this._logger.log(message);
    };

    Queue.prototype._dispatch = function(name, options, blobs, done) {
        var task = this._registry.task(name);

        // Task type determines how blobs are processed
        switch (task.type) {
            case 'append': // Add blobs to queue
                if (options === undefined) {
                    options = [];
                } else {
                    if (!Array.isArray(options)) {
                        options = [options];
                    }
                }

                async.map(options, task.bind(this), function(err, results) {
                    done(err, blobs.concat(results));
                });
                break;

            case 'iterate': // Task can look at all blobs at once
                task.call(this, options, blobs, done);
                break;

            case 'reduce': // Reduce blobs operating on a per task basis
                async.reduce(blobs, new Blob(), task.bind(this, options), function(err, results) {
                    done(err, [results]);
                });
                break;

            case 'slice': // Select up to options.length blobs
                async.map(blobs.slice(0, Array.isArray(options) ? options.length : 1), task.bind(this, options), done);
                break;

            default: // Transform blob on a per task basis
                async.map(blobs, task.bind(this, options), done);
                break;
        }
    };

    Queue.prototype.task = function(name, options) {
        this._queue.push(this._dispatch.bind(this, name, options));
        return this;
    };

    Queue.prototype.run = function(callback) {
        async.waterfall(this._queue, callback);
    };
})(typeof exports === 'undefined' ? this.gear : exports);