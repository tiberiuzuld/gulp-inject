'use strict';
var through2 = require('through2');
var gutil = require('gulp-util');
var streamToArray = require('stream-to-array');
var extname = require('../extname');
var transform = require('../transform');
var tags = require('../tags');
var getFilepath = require('../path');

var PluginError = gutil.PluginError;
var magenta = gutil.colors.magenta;
var cyan = gutil.colors.cyan;

/**
 * Constants
 */
var PLUGIN_NAME = 'gulp-inject';

module.exports = exports = function (sources, opt) {
  if (!sources) {
    throw error('Missing sources stream!');
  }
  if (!opt) {
    opt = {};
  }

  if (opt.sort) {
    throw error('sort option is deprecated! Use `sort-stream` module instead!');
  }
  if (opt.templateString) {
    throw error('`templateString` option is deprecated! Create a virtual `vinyl` file instead!');
  }
  if (opt.transform && typeof opt.transform !== 'function') {
    throw error('transform option must be a function');
  }
  // Notify people of common mistakes...
  if (typeof opt.read !== 'undefined') {
    throw error('There is no `read` option. Did you mean to provide it for `gulp.src` perhaps?');
  }

  // Defaults:
  opt.quiet = bool(opt, 'quiet', false);
  opt.relative = bool(opt, 'relative', false);
  opt.addRootSlash = bool(opt, 'addRootSlash', !opt.relative);
  opt.transform = defaults(opt, 'transform', transform);
  opt.tags = tags();
  opt.tags.name = defaults(opt, 'name', 'inject');
  transform.selfClosingTag = bool(opt, 'selfClosingTag', false);

  // Is the first parameter a Vinyl File Stream:
  if (typeof sources.on === 'function' && typeof sources.pipe === 'function') {
    return handleVinylStream(sources, opt);
  }

  throw error('passing target file as a string is deprecated! Pass a vinyl file stream (i.e. use `gulp.src`)!');
};

function defaults(options, prop, defaultValue) {
  return options[prop] || defaultValue;
}

function bool(options, prop, defaultVal) {
  return typeof options[prop] === 'undefined' ? defaultVal : Boolean(options[prop]);
}

/**
 * Handle injection when files to
 * inject comes from a Vinyl File Stream
 *
 * @param {Stream} sources
 * @param {Object} opt
 * @returns {Stream}
 */
function handleVinylStream(sources, opt) {
  var collected = streamToArray(sources);

  return through2.obj(function (target, enc, cb) {
    if (target.isStream()) {
      return cb(error('Streams not supported for target templates!'));
    }
    collected.then(function (collection) {
      target.contents = getNewContent(target, collection, opt);
      this.push(target);
      cb();
    }.bind(this))
    .catch(function (err) {
      cb(err);
    });
  });
}

/**
 * Get new content for template
 * with all injections made
 *
 * @param {Object} target
 * @param {Array} collection
 * @param {Object} opt
 * @returns {Buffer}
 */
function getNewContent(target, collection, opt) {
  var oldContent = target.contents;
  if (!opt.quiet) {
    if (collection.length) {
      log(cyan(collection.length) + ' files into ' + magenta(target.relative) + '.');
    } else {
      log('Nothing to inject into ' + magenta(target.relative) + '.');
    }
  }

  var tags = {};
  var targetExt = extname(target.path);

  var filesPerTags = groupBy(collection, function (file) {
    var ext = extname(file.path);
    var startTag = opt.tags.start(targetExt, ext, opt.starttag);
    var endTag = opt.tags.end(targetExt, ext, opt.endtag);
    var tag = startTag + endTag;
    if (!tags[tag]) {
      tags[tag] = {start: startTag, end: endTag};
    }
    return tag;
  });

  var startAndEndTags = Object.keys(filesPerTags);

  var matches = [];

  var contents = startAndEndTags.reduce(function eachInCollection(contents, tagKey) {
    var files = filesPerTags[tagKey];
    var startTag = tags[tagKey].start;
    var endTag = tags[tagKey].end;

    return contents.replace(
      getInjectorTagsRegExp(startTag, endTag),
      function injector(match, starttag, indent, content, endtag) {
        matches.push(starttag);
        var starttagArray = opt.removeTags ? [] : [starttag];
        var endtagArray = opt.removeTags ? [] : [endtag];
        return starttagArray
          .concat(getTagsToInject(files, target, opt))
          .concat(endtagArray)
          .join(indent);
      }
    );
  }, String(oldContent));

  if (opt.empty) {
    contents = contents.replace(
      getInjectorTagsRegExp(
        opt.tags.start(targetExt, '{{ANY}}', opt.starttag),
        opt.tags.end(targetExt, '{{ANY}}', opt.starttag)
      ),
      function injector2(match, starttag, unused, indent, content, endtag) {
        if (matches.indexOf(starttag) > -1) {
          return match;
        }
        if (opt.removeTags) {
          return '';
        }
        return [starttag].concat(endtag).join(indent);
      }
    );
  }

  return new Buffer(contents);
}

function getInjectorTagsRegExp(starttag, endtag) {
  return new RegExp('(' + tag(starttag) + ')(\\s*)(\\n|\\r|.)*?(' + tag(endtag) + ')', 'gi');
}

function tag(str) {
  var parts = str.split(/\{\{ANY\}\}/g);
  return parts.map(escapeForRegExp).map(makeWhiteSpaceOptional).join('(.+)');
}

function makeWhiteSpaceOptional(str) {
  return str.replace(/\s+/g, '\\s*');
}

function escapeForRegExp(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function getTagsToInject(files, target, opt) {
  return files.reduce(function transformFile(lines, file, i) {
    var filepath = getFilepath(file, target, opt);
    var transformedContents = opt.transform(filepath, file, i, files.length, target);
    if (typeof transformedContents !== 'string') {
      return lines;
    }
    return lines.concat(transformedContents);
  }, []);
}

function groupBy(arr, cb) {
  var result = {};
  for (var i = 0; i < arr.length; i++) {
    var key = cb(arr[i]);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(arr[i]);
  }
  return result;
}

function log(message) {
  gutil.log(magenta(PLUGIN_NAME), message);
}

function error(message) {
  return new PluginError(PLUGIN_NAME, message);
}
