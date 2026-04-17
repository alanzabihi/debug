'use strict';

// xo@0.23 depends on util.isDate/isRegExp removed in Node 22+
const util = require('util');
if (typeof util.isDate !== 'function') {
	util.isDate = d => d instanceof Date;
	util.isRegExp = d => d instanceof RegExp;
	util.isArray = Array.isArray;
	util.isBuffer = Buffer.isBuffer;
	util.isNull = v => v === null;
	util.isNullOrUndefined = v => v == null;
	util.isUndefined = v => v === undefined;
	util.isString = v => typeof v === 'string';
	util.isNumber = v => typeof v === 'number';
	util.isObject = v => typeof v === 'object' && v !== null;
	util.isFunction = v => typeof v === 'function';
	util.isBoolean = v => typeof v === 'boolean';
	util.isPrimitive = v => v === null || (typeof v !== 'object' && typeof v !== 'function');
}
