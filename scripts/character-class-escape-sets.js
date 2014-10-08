var fs = require('fs');
var jsesc = require('jsesc');
var regenerate = require('regenerate');

// https://github.com/mathiasbynens/regexpu/issues/7
var Zs = require('unicode-5.1.0/categories/Zs/code-points.js');
var latestZs = require('unicode-7.0.0/categories/Zs/code-points.js');

var iuMappings = require('../data/iu-mappings.json');
var oneWayMappings = require('../data/simple-case-folding-mappings.json');

var object = {};
var hasOwnProperty = object.hasOwnProperty;
function has(object, property) {
	return hasOwnProperty.call(object, property);
}

function caseFold(codePoint) {
	return has(iuMappings, codePoint) ? iuMappings[codePoint] : false;
}

// Prepare a Regenerate set containing all code points, used for negative
// character classes (if any).
var UNICODE_SET = regenerate().addRange(0x0, 0x10FFFF);
// Without the `u` flag, the range stops at 0xFFFF.
// https://mths.be/es6#sec-pattern-semantics
var BMP_SET = regenerate().addRange(0x0, 0xFFFF);

var ESCAPE_CHARS = {};
var ESCAPE_CHARS_UNICODE = {};
var ESCAPE_CHARS_UNICODE_IGNORE_CASE = {};
function addCharacterClassEscape(lower, set) {
	ESCAPE_CHARS[lower] = ESCAPE_CHARS_UNICODE[lower] = set;
	var upper = lower.toUpperCase();
	ESCAPE_CHARS[upper] = BMP_SET.clone().remove(set);
	var uExcludeSet = UNICODE_SET.clone().remove(set);
	ESCAPE_CHARS_UNICODE[upper] = uExcludeSet;
	// Check if one or more symbols in this set fold to another one. If so,
	// a copy of the set including the mapped symbols is created for use with
	// regular expressions that have both the `u` and `i` flags set.
	var codePoints = set.toArray();
	var iuSet = regenerate();
	var containsFoldingSymbols = false;
	codePoints.forEach(function(codePoint) {
		var folded = caseFold(codePoint);
		if (folded) {
			containsFoldingSymbols = true;
			iuSet.add(folded);
			folded = caseFold(folded);
			if (folded) {
				iuSet.add(folded);
			}
		}
	});
	ESCAPE_CHARS_UNICODE_IGNORE_CASE[lower] = containsFoldingSymbols ?
		iuSet.clone().add(set) :
		set;
	ESCAPE_CHARS_UNICODE_IGNORE_CASE[upper] = containsFoldingSymbols ?
		iuSet.clone().add(uExcludeSet) :
		uExcludeSet;
}

// Prepare a Regenerate set for every existing character class escape.
// https://mths.be/es6#sec-characterclassescape
addCharacterClassEscape(
	'd', // `\d` and `\D`
	regenerate().addRange('0', '9')
);
addCharacterClassEscape(
	's', // `\s` and `\S`
	regenerate(
		// https://mths.be/es6#sec-white-space
		0x0009,
		0x000B,
		0x000C,
		0x0020,
		0x00A0,
		0xFEFF,
		Zs,
		latestZs,
		// https://mths.be/es6#sec-line-terminators
		0x000A,
		0x000D,
		0x2028,
		0x2029
	)
);
addCharacterClassEscape(
	'w', // `\w` and `\W`
	regenerate('_').addRange('a', 'z').addRange('A', 'Z').addRange('0', '9')
);

/*----------------------------------------------------------------------------*/

function codePointToString(codePoint) {
	return '0x' + codePoint.toString(16).toUpperCase();
}

// Regenerate plugin that turns a set into some JavaScript source code that
// generates that set.
regenerate.prototype.toCode = function() {
	var data = this.data;
	// Iterate over the data per `(start, end)` pair.
	var index = 0;
	var start;
	var end;
	var length = data.length;
	var loneCodePoints = [];
	var ranges = [];
	while (index < length) {
		start = data[index];
		end = data[index + 1] - 1; // Note: the `- 1` makes `end` inclusive.
		if (start == end) {
			loneCodePoints.push(codePointToString(start));
		} else {
			ranges.push(
				'addRange(' + codePointToString(start) +
				', ' + codePointToString(end) + ')'
			);
		}
		index += 2;
	}
	return 'regenerate(' + loneCodePoints.join(', ') + ')' +
		(ranges.length ? '\n\t\t.' + ranges.join('\n\t\t.') : '');
};

function stringify(name, object) {
	var source = 'exports.' + name + ' = {\n\t' + Object.keys(object).map(function(character) {
		var set = object[character];
		return jsesc(character, { 'wrap': true }) + ': ' + set.toCode();
	}).join(',\n\t') + '\n};';
	return source;
}

var source = [
	'// Generated by `/scripts/character-class-escape-sets.js`. Do not edit.\n' +
	'var regenerate = require(\'regenerate\');',
	stringify('REGULAR', ESCAPE_CHARS),
	stringify('UNICODE', ESCAPE_CHARS_UNICODE),
	stringify('UNICODE_IGNORE_CASE', ESCAPE_CHARS_UNICODE_IGNORE_CASE)
].join('\n\n');

// Save the precompiled sets to a static file.
fs.writeFileSync('data/character-class-escape-sets.js', source + '\n');
