/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.0.2 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
/*jslint regexp: true, nomen: true */
/*global window, navigator, document, importScripts, jQuery, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    'use strict';

    var version = '2.0.2',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        ostring = Object.prototype.toString,
        ap = Array.prototype,
        aps = ap.slice,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && navigator && document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false,
        req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return obj.hasOwnProperty(prop);
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     * This is not robust in IE for transferring methods that match
     * Object.prototype names, but the uses of mixin here seem unlikely to
     * trigger a problem related to that.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value !== 'string') {
                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    //Allow getting a global that expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    function makeContextModuleFunc(func, relMap, enableBuildCallback) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0), lastArg;
            if (enableBuildCallback &&
                isFunction((lastArg = args[args.length - 1]))) {
                lastArg.__requireJsBuild = true;
            }
            args.push(relMap);
            return func.apply(null, args);
        };
    }

    function addRequireMethods(req, context, relMap) {
        each([
            ['toUrl'],
            ['undef'],
            ['defined', 'requireDefined'],
            ['specified', 'requireSpecified']
        ], function (item) {
            var prop = item[1] || item[0];
            req[item[0]] = context ? makeContextModuleFunc(context[prop], relMap) :
                //If no context, then use default context. Reference from
                //contexts instead of early binding to default context, so
                //that during builds, the latest instance of the default
                //context with its config gets used.
                function () {
                    var ctx = contexts[defContextName];
                    return ctx[prop].apply(ctx, arguments);
                };
        });
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var config = {
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                pkgs: {},
                shim: {}
            },
            registry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            requireCounter = 1,
            unnormalizedCounter = 1,
            //Used to track the order in which modules
            //should be executed, by the order they
            //load. Important for consistent cycle resolution
            //behavior.
            waitAry = [],
            inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; ary[i]; i+= 1) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var baseParts = baseName && baseName.split('/'),
                map = config.map,
                starMap = map && map['*'],
                pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment,
                foundMap;

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    if (config.pkgs[baseName]) {
                        //If the baseName is a package name, then just treat it as one
                        //name to concat the name with.
                        baseParts = [baseName];
                    } else {
                        //Convert baseName to array, and lop off the last part,
                        //so that . matches that 'directory' and not name of the baseName's
                        //module. For instance, baseName of 'one/two/three', maps to
                        //'one/two/three.js', but we want the directory, 'one/two' for
                        //this normalization.
                        baseParts = baseParts.slice(0, baseParts.length - 1);
                    }

                    name = baseParts.concat(name.split('/'));
                    trimDots(name);

                    //Some use of packages may use a . path to reference the
                    //'main' module name, so normalize for that.
                    pkgConfig = config.pkgs[(pkgName = name[0])];
                    name = name.join('/');
                    if (pkgConfig && name === pkgName + '/' + pkgConfig.main) {
                        name = pkgName;
                    }
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && (baseParts || starMap) && map) {
                nameParts = name.split('/');

                for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = map[baseParts.slice(0, j).join('/')];

                            //baseName segment has  config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = mapValue[nameSegment];
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    break;
                                }
                            }
                        }
                    }

                    if (!foundMap && starMap && starMap[nameSegment]) {
                        foundMap = starMap[nameSegment];
                    }

                    if (foundMap) {
                        nameParts.splice(0, i, foundMap);
                        name = nameParts.join('/');
                        break;
                    }
                }
            }

            return name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                        scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = config.paths[id];
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                removeScript(id);
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.undef(id);
                context.require([id]);
                return true;
            }
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var index = name ? name.indexOf('!') : -1,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '',
                url, pluginModule, suffix;

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            if (index !== -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = defined[prefix];
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Calculate url for the module, if it has a name.
                    //Use name here since nameToUrl also calls normalize,
                    //and for relative names that are outside the baseUrl
                    //this causes havoc. Was thinking of just removing
                    //parentModuleMap to avoid extra normalization, but
                    //normalize() still does a dot removal because of
                    //issue #142, so just pass in name here and redo
                    //the normalization. Paths outside baseUrl are just
                    //messy to support.
                    url = context.nameToUrl(name, null, parentModuleMap);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                    prefix + '!' + normalizedName :
                    normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = registry[id];

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = registry[id];

            if (hasProp(defined, id) &&
                (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                getModule(depMap).on(name, fn);
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = registry[id];
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length - 1, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        /**
         * Helper function that creates a require function object to give to
         * modules that ask for it as a dependency. It needs to be specific
         * per module because of the implication of path mappings that may
         * need to be relative to the module name.
         */
        function makeRequire(mod, enableBuildCallback, altRequire) {
            var relMap = mod && mod.map,
                modRequire = makeContextModuleFunc(altRequire || context.require,
                                                   relMap,
                                                   enableBuildCallback);

            addRequireMethods(modRequire, context, relMap);
            modRequire.isBrowser = isBrowser;

            return modRequire;
        }

        handlers = {
            'require': function (mod) {
                return makeRequire(mod);
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    return (mod.exports = defined[mod.map.id] = {});
                }
            },
            'module': function (mod) {
                return (mod.module = {
                    id: mod.map.id,
                    uri: mod.map.url,
                    config: function () {
                        return (config.config && config.config[mod.map.id]) || {};
                    },
                    exports: defined[mod.map.id]
                });
            }
        };

        function removeWaiting(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];

            each(waitAry, function (mod, i) {
                if (mod.map.id === id) {
                    waitAry.splice(i, 1);
                    if (!mod.defined) {
                        context.waitCount -= 1;
                    }
                    return true;
                }
            });
        }

        function findCycle(mod, traced) {
            var id = mod.map.id,
                depArray = mod.depMaps,
                foundModule;

            //Do not bother with unitialized modules or not yet enabled
            //modules.
            if (!mod.inited) {
                return;
            }

            //Found the cycle.
            if (traced[id]) {
                return mod;
            }

            traced[id] = true;

            //Trace through the dependencies.
            each(depArray, function (depMap) {
                var depId = depMap.id,
                    depMod = registry[depId];

                if (!depMod) {
                    return;
                }

                if (!depMod.inited || !depMod.enabled) {
                    //Dependency is not inited, so this cannot
                    //be used to determine a cycle.
                    foundModule = null;
                    delete traced[id];
                    return true;
                }

                //mixin traced to a new object for each dependency, so that
                //sibling dependencies in this object to not generate a
                //false positive match on a cycle. Ideally an Object.create
                //type of prototype delegation would be used here, but
                //optimizing for file size vs. execution speed since hopefully
                //the trees are small for circular dependency scans relative
                //to the full app perf.
                return (foundModule = findCycle(depMod, mixin({}, traced)));
            });

            return foundModule;
        }

        function forceExec(mod, traced, uninited) {
            var id = mod.map.id,
                depArray = mod.depMaps;

            if (!mod.inited || !mod.map.isDefine) {
                return;
            }

            if (traced[id]) {
                return defined[id];
            }

            traced[id] = mod;

            each(depArray, function(depMap) {
                var depId = depMap.id,
                    depMod = registry[depId],
                    value;

                if (handlers[depId]) {
                    return;
                }

                if (depMod) {
                    if (!depMod.inited || !depMod.enabled) {
                        //Dependency is not inited,
                        //so this module cannot be
                        //given a forced value yet.
                        uninited[id] = true;
                        return;
                    }

                    //Get the value for the current dependency
                    value = forceExec(depMod, traced, uninited);

                    //Even with forcing it may not be done,
                    //in particular if the module is waiting
                    //on a plugin resource.
                    if (!uninited[depId]) {
                        mod.defineDepById(depId, value);
                    }
                }
            });

            mod.check(true);

            return defined[id];
        }

        function modCheck(mod) {
            mod.check();
        }

        function checkLoaded() {
            var waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                stillLoading = false,
                needCycleCheck = true,
                map, modId, err, usingPathFallback;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(registry, function (mod) {
                map = mod.map;
                modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {

                each(waitAry, function (mod) {
                    if (mod.defined) {
                        return;
                    }

                    var cycleMod = findCycle(mod, {}),
                        traced = {};

                    if (cycleMod) {
                        forceExec(cycleMod, traced, {});

                        //traced modules may have been
                        //removed from the registry, but
                        //their listeners still need to
                        //be called.
                        eachProp(traced, modCheck);
                    }
                });

                //Now that dependencies have
                //been satisfied, trigger the
                //completion check that then
                //notifies listeners.
                eachProp(registry, modCheck);
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = undefEvents[map.id] || {};
            this.map = map;
            this.shim = config.shim[map.id];
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function(depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);
                this.depMaps.rjsSkipMap = depMaps.rjsSkipMap;

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDepById: function (id, depExports) {
                var i;

                //Find the index for this dependency.
                each(this.depMaps, function (map, index) {
                    if (map.id === id) {
                        i = index;
                        return true;
                    }
                });

                return this.defineDep(i, depExports);
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    makeRequire(this, true)(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function() {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks is the module is ready to define itself, and if so,
             * define it. If the silent argument is true, then it will just
             * define, but not notify listeners, and not ask for a context-wide
             * check of all loaded modules. That is useful for cycle breaking.
             */
            check: function (silent) {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory,
                    err, cjsModule;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error.
                            if (this.events.error) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            if (this.map.isDefine) {
                                //If setting exports via 'module' is in play,
                                //favor that over return value and exports. After that,
                                //favor a non-undefined return value over exports use.
                                cjsModule = this.module;
                                if (cjsModule &&
                                    cjsModule.exports !== undefined &&
                                    //Make sure it is not already the exports value
                                    cjsModule.exports !== this.exports) {
                                    exports = cjsModule.exports;
                                } else if (exports === undefined && this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = [this.map.id];
                                err.requireType = 'define';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        delete registry[id];

                        this.defined = true;
                        context.waitCount -= 1;
                        if (context.waitCount === 0) {
                            //Clear the wait array used for cycles.
                            waitAry = [];
                        }
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (!silent) {
                        if (this.defined && !this.defineEmitted) {
                            this.defineEmitted = true;
                            this.emit('defined', this.exports);
                            this.defineEmitComplete = true;
                        }
                    }
                }
            },

            callPlugin: function() {
                var map = this.map,
                    id = map.id,
                    pluginMap = makeModuleMap(map.prefix, null, false, true);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        load, normalizedMap, normalizedMod;

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap,
                                                      false,
                                                      true);
                        on(normalizedMap,
                           'defined', bind(this, function (value) {
                            this.init([], function () { return value; }, null, {
                                enabled: true,
                                ignore: true
                            });
                        }));
                        normalizedMod = registry[normalizedMap.id];
                        if (normalizedMod) {
                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                removeWaiting(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = function (moduleName, text) {
                        /*jslint evil: true */
                        var hasInteractive = useInteractive;

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(makeModuleMap(moduleName));

                        req.exec(text);

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Support anonymous modules.
                        context.completeLoad(moduleName);
                    };

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, makeRequire(map.parentMap, true, function (deps, cb) {
                        deps.rjsSkipMap = true;
                        return context.require(deps, cb);
                    }), load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                this.enabled = true;

                if (!this.waitPushed) {
                    waitAry.push(this);
                    context.waitCount += 1;
                    this.waitPushed = true;
                }

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.depMaps.rjsSkipMap);
                        this.depMaps[i] = depMap;

                        handler = handlers[depMap.id];

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', this.errback);
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!handlers[id] && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = registry[pluginMap.id];
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function(name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry/waitAry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        return (context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            waitCount: 0,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths and packages since they require special processing,
                //they are additive.
                var pkgs = config.pkgs,
                    shim = config.shim,
                    paths = config.paths,
                    map = config.map;

                //Mix in the config values, favoring the new values over
                //existing ones in context.config.
                mixin(config, cfg, true);

                //Merge paths.
                config.paths = mixin(paths, cfg.paths, true);

                //Merge map
                if (cfg.map) {
                    config.map = mixin(map || {}, cfg.map, true, true);
                }

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if (value.exports && !value.exports.__buildReady) {
                            value.exports = context.makeShimExports(value.exports);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;
                        location = pkgObj.location;

                        //Create a brand new object on pkgs, since currentPackages can
                        //be passed in again, and config.pkgs is the internal transformed
                        //state for all package configs.
                        pkgs[pkgObj.name] = {
                            name: pkgObj.name,
                            location: location || pkgObj.name,
                            //Remove leading dot in main, so main paths are normalized,
                            //and remove any trailing .js, since different package
                            //envs have different conventions: some use a module name,
                            //some use a file name.
                            main: (pkgObj.main || 'main')
                                  .replace(currDirRegExp, '')
                                  .replace(jsSuffixRegExp, '')
                        };
                    });

                    //Done with modifications, assing packages back to context config
                    config.pkgs = pkgs;
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    mod.map = makeModuleMap(id);
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (exports) {
                var func;
                if (typeof exports === 'string') {
                    func = function () {
                        return getGlobal(exports);
                    };
                    //Save the exports for use in nodefine checking.
                    func.exports = exports;
                    return func;
                } else {
                    return function () {
                        return exports.apply(global, arguments);
                    };
                }
            },

            requireDefined: function (id, relMap) {
                return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
            },

            requireSpecified: function (id, relMap) {
                id = makeModuleMap(id, relMap, false, true).id;
                return hasProp(defined, id) || hasProp(registry, id);
            },

            require: function (deps, callback, errback, relMap) {
                var moduleName, id, map, requireMod, args;
                if (typeof deps === 'string') {
                    if (isFunction(callback)) {
                        //Invalid call
                        return onError(makeError('requireargs', 'Invalid require call'), errback);
                    }

                    //Synchronous access to one module. If require.get is
                    //available (as in the Node adapter), prefer that.
                    //In this case deps is the moduleName and callback is
                    //the relMap
                    if (req.get) {
                        return req.get(context, deps, callback);
                    }

                    //Just return the module wanted. In this scenario, the
                    //second arg (if passed) is just the relMap.
                    moduleName = deps;
                    relMap = callback;

                    //Normalize module name, if it contains . or ..
                    map = makeModuleMap(moduleName, relMap, false, true);
                    id = map.id;

                    if (!hasProp(defined, id)) {
                        return onError(makeError('notloaded', 'Module name "' +
                                    id +
                                    '" has not been loaded yet for context: ' +
                                    contextName));
                    }
                    return defined[id];
                }

                //Callback require. Normalize args. if callback or errback is
                //not a function, it means it is a relMap. Test errback first.
                if (errback && !isFunction(errback)) {
                    relMap = errback;
                    errback = undefined;
                }
                if (callback && !isFunction(callback)) {
                    relMap = callback;
                    callback = undefined;
                }

                //Any defined modules in the global queue, intake them now.
                takeGlobalQueue();

                //Make sure any remaining defQueue items get properly processed.
                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                    } else {
                        //args are id, deps, factory. Should be normalized by the
                        //define() function.
                        callGetModule(args);
                    }
                }

                //Mark all the dependencies as needing to be loaded.
                requireMod = getModule(makeModuleMap(null, relMap));

                requireMod.init(deps, callback, errback, {
                    enabled: true
                });

                checkLoaded();

                return context.require;
            },

            undef: function (id) {
                var map = makeModuleMap(id, null, true),
                    mod = registry[id];

                delete defined[id];
                delete urlFetched[map.url];
                delete undefEvents[id];

                if (mod) {
                    //Hold on to listeners in case the
                    //module will be attempted to be reloaded
                    //using a different config.
                    if (mod.events.defined) {
                        undefEvents[id] = mod.events;
                    }

                    removeWaiting(id);
                }
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. parent module is passed in for context,
             * used by the optimizer.
             */
            enable: function (depMap, parent) {
                var mod = registry[depMap.id];
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var shim = config.shim[moduleName] || {},
                shExports = shim.exports && shim.exports.exports,
                found, args, mod;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = registry[moduleName];

                if (!found &&
                    !defined[moduleName] &&
                    mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exports]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name + .extension into an URL path.
             * *Requires* the use of a module name. It does not support using
             * plain URLs like nameToUrl.
             */
            toUrl: function (moduleNamePlusExt, relModuleMap) {
                var index = moduleNamePlusExt.lastIndexOf('.'),
                    ext = null;

                if (index !== -1) {
                    ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                    moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                }

                return context.nameToUrl(moduleNamePlusExt, ext, relModuleMap);
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             */
            nameToUrl: function (moduleName, ext, relModuleMap) {
                var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url,
                    parentPath;

                //Normalize module name if have a base relative module name to work from.
                moduleName = normalize(moduleName, relModuleMap && relModuleMap.id, true);

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;
                    pkgs = config.pkgs;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');
                        pkg = pkgs[parentModule];
                        parentPath = paths[parentModule];
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        } else if (pkg) {
                            //If module name is just the package name, then looking
                            //for the main module.
                            if (moduleName === pkg.name) {
                                pkgPath = pkg.location + '/' + pkg.main;
                            } else {
                                pkgPath = pkg.location;
                            }
                            syms.splice(0, i, pkgPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/') + (ext || '.js');
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callack function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                    (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error', evt, [data.id]));
                }
            }
        });
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var contextName = defContextName,
            context, config;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = contexts[contextName];
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require, using
    //default context if no context specified.
    addRequireMethods(req);

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = function (err) {
        throw err;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = config.xhtml ?
                   document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                   document.createElement('script');
            node.type = config.scriptType || 'text/javascript';
            node.charset = 'utf-8';

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                //Check if node.attachEvent is artificially added by custom script or
                //natively supported by browser
                //read https://github.com/jrburke/requirejs/issues/187
                //if we can NOT find [native code] then it must NOT natively supported.
                //in IE8, node.attachEvent does not have toString()
                //Note the test for "[native code" with no closing brace, see:
                //https://github.com/jrburke/requirejs/issues/273
                !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEvenListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            //In a web worker, use importScripts. This is not a very
            //efficient use of importScripts, importScripts will block until
            //its script is downloaded and evaluated. However, if web workers
            //are in play, the expectation that a build has been done so that
            //only one script needs to be loaded anyway. This may need to be
            //reevaluated if other use cases become common.
            importScripts(url);

            //Account for anonymous modules
            context.completeLoad(moduleName);
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {

                //Pull off the directory of data-main for use as the
                //baseUrl.
                src = dataMain.split('/');
                mainScript = src.pop();
                subPath = src.length ? src.join('/')  + '/' : './';

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since dataMain is now
                //like a module name.
                dataMain = mainScript.replace(jsSuffixRegExp, '');

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(dataMain) : [dataMain];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous functions
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = [];
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps.length && isFunction(callback)) {
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

define('async', ['require', 'exports', 'module'], function(require, exports, module) {

/*global setTimeout: false, console: false */
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
                        callback();
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
                        callback();
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
            iterator(arr[started], function (err) {
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
            started += 1;
            running += 1;
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
                }, true);
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
      }
    };

}());


});



define('./blob', ['require', 'exports'], function(require, exports) {

/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

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

    var result = '',
        props = {},
        self = this;

    parts.forEach(function(part) {
        result += part;

        if (part instanceof Blob) {
            Object.keys(part).forEach(function(attr) {
                props[attr] = part[attr];
            });
        }
    });

    Object.keys(properties).forEach(function(attr) {
        props[attr] = properties[attr];
    });

    Object.keys(props).forEach(function(attr) {
        if (attr !== 'result') {
            Object.defineProperty(self, attr, {enumerable: true, value: props[attr]});
        }
    });

    Object.defineProperty(this, 'result', {value: result});
};

Blob.prototype.toString = function() {
    return this.result;
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

Blob.readFile = Blob.prototype.readFile = (typeof module === 'undefined') ? readFile.client : readFile.server;

var writeFile = {
    server: function(name, blob, encoding, callback) {
        var fs = require('fs'),
            path = require('path'),
            mkdirp = require('mkdirp').mkdirp,
            Crypto = require('crypto');
        
        function writeFile(filename, b) {
            fs.writeFile(filename, b.result, function(err) {
                callback(err, new Blob(b, {name: filename}));
            });
        }

        var dirname = path.resolve(path.dirname(name)),
            checksum;

        if (name.indexOf('{checksum}') > -1) {  // Replace {checksum} with md5 string
            checksum = Crypto.createHash('md5');
            checksum.update(blob.result);
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
        localStorage[name] = blob.result;
        callback(null, new blob.constructor(blob, {name: name}));
    }
};

Blob.writeFile = Blob.prototype.writeFile = (typeof module === 'undefined') ? writeFile.client : writeFile.server;

});



define('./tasks/concat', ['require', 'exports'], function(require, exports) {

/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

/**
 * Concatenates blobs.
 *
 * @param options {Object} Concat options.
 * @param options.callback {Function} Callback on each blob.
 * @param blobs {Array} Incoming blobs.
 * @param done {Function} Callback on task completion.
 */
exports.concat = function(options, prev, blob, done) {
    options = options || {};
    done(null, new blob.constructor([prev, options.callback ? options.callback(blob) : blob]));
};

});



define('./tasks/core', ['require', 'exports', '../blob'], function(require, exports) {

/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

var Blob = require('../blob').Blob;

/**
 * Add a blob string.
 *
 * @param index {Integer} Index of blobs.
 * @param blobs {Array} Incoming blobs.
 * @param done {Function} Callback on task completion.
 */
exports.load = function(string, done) {
    done(null, new Blob(string));
};

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
get.type = 'collect';

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
log.type = 'collect';

/**
 * Inspects blobs.
 *
 * @param options {Object} Ignored.
 * @param blob {Object} Incoming blobs.
 * @param done {Function} Callback on task completion.
 */
var inspect = exports.inspect = function inspect(options, blobs, done) {
    var self = this;

    blobs.forEach(function(blob, index) {
        var obj = {result: blob.result};
        Object.keys(blob).forEach(function(attr) {obj[attr] = blob[attr];});
        self._log('blob ' + (index + 1) + ': ' + JSON.stringify(obj, null, ' '));
    });

    done(null, blobs);
};
inspect.type = 'collect';

/**
 * Do nothing.
 *
 * @param dummy {N/A} N/A.
 * @param blob {Array} Incoming blob.
 * @param done {Function} Callback on task completion.
 */
exports.noop = function(dummy, blob, done) {
    done(null, blob);
};


});



define('./tasks/read', ['require', 'exports', '../blob'], function(require, exports) {

/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
var Blob = require('../blob').Blob;

/**
 * Appends file contents onto queue.
 *
 * @param options {Object} File options or filename.
 * @param options.name {String} Filename to read.
 * @param options.encoding {String} File encoding.
 * @param done {Function} Callback on task completion.
 */
exports.read = function(options, done) {
    options = (typeof options === 'string') ? {name: options} : options;
    var encoding = options.encoding || 'utf8';
    Blob.readFile(options.name, encoding, done);
};

});



define('./tasks/write', ['require', 'exports'], function(require, exports) {

/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

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

});



define('./tasks/tasks', ['require', 'exports', 'async'], function(require, exports) {

/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
var async = require('async');

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
tasks.type = 'collect';

});



define('./registry', ['require', 'exports', './tasks/concat', './default_tasks'], function(require, exports) {

/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
if (typeof module !== 'undefined') {
    var path = require('path');
}
else {
    var default_tasks = require('./default_tasks');
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

});



define('./queue', ['require', 'exports', 'async', './registry', './blob'], function(require, exports) {

/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
var async = require('async'),
    Registry = require('./registry').Registry,
    Blob = require('./blob').Blob;

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

    // Task parameters determine how blobs are processed
    switch (task.length) {
        case 2: // Add blobs to queue
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

        case 3:
            if (task.type === 'collect') { // Task can look at all blobs at once
                task.call(this, options, blobs, done);
            } else if (task.type === 'slice') { // Select up to options.length blobs
                async.map(blobs.slice(0, Array.isArray(options) ? options.length : 1), task.bind(this, options), done);
            } else { // Transform blob on a per task basis
                async.map(blobs, task.bind(this, options), done);
            }
            break;

        case 4: // Reduce blobs operating on a per task basis
            async.reduce(blobs, new Blob(), task.bind(this, options), function(err, results) {
                done(err, [results]);
            });
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

});

define('../blob', ['require', 'exports', 'blob'], function(require, exports, blob) {
exports.Blob = blob.Blob;
});

define('./default_tasks', ['require', 'exports', './tasks/concat', './tasks/core', './tasks/read', './tasks/write', './tasks/tasks'], function(require, exports) {
var tasks = [];
tasks.push(require('./tasks/concat'));tasks.push(require('./tasks/core'));tasks.push(require('./tasks/read'));tasks.push(require('./tasks/write'));tasks.push(require('./tasks/tasks'));
tasks.forEach(function(mod) {for (var task in mod) {exports[task] = mod[task];}});
});

define('gear', ['require', 'exports', 'blob', 'registry', 'queue'], function(require, exports, blob, registry, queue) {
exports.Blob = blob.Blob; exports.Registry = registry.Registry; exports.Queue = queue.Queue;
});

