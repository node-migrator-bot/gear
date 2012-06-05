/*
 * Copyright (c) 2011-2012, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
var path = require('path'),
    fs = require('fs');

/*
 * Gearbox - Container for available tasks.
 */
var Gearbox = exports.Gearbox = function Gearbox(options) {
    var self = this;
    this._tasks = {};

    if (options) {
        this.load(options);
    }

    Object.defineProperty(this, 'tasks', {get: function() {
        return Object.keys(self._tasks);
    }});
};

Gearbox.prototype = {
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
    },

    _loadModule: function(name) {
        this._loadDir(path.resolve('node_modules', name, 'lib'));
    },

    _loadDir: function(dirname) {
        var files = fs.readdirSync(dirname),
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

        var name,
            file = require(filename);

        for (name in file) {
            this._tasks[name] = file[name];
        }
    },

    task: function(name) {
        return this._tasks[name];
    }
};