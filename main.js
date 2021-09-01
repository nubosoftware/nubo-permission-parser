"use strict";

var _ = require("underscore");
var path = require("path");

var validate = require("validate.js");
/*
 *  Main class
 *    Arguments:
 *      _rules - array of objects rule
 *        rule's parameters:
 *          path - string, url path
 *          regex - optional boolean, true if path is regular expression, default false
 *          constraints - optional objects (for descroption read https://validatejs.org/)
 *      opts - optional object
 *          logd - function(string) to log debug messages
 *          loge - function(string) to log error messages
 *          permittedMode - boolean, true permit all request, but show error messages
 *          badRequestHandler - function(req, res, next, checkRes), hook function that will been
 *              called instead of drop request, programmer should decide what he do with the request
 *            req, res, next - usual arguments of restify server.use handler
 *            checkRes - object describe problem in request
 */

var filterMode = {
    URL: 0,
    BODY: 1
};

var job = function(_rules, _opts) {
    var rules = {
        regex: []
    };
    var self = this;
    var logd, loge, mode;
    var opts = _opts || {};
    var dummyFunction = function() {};
    if (typeof _opts === "object") {
        opts.logd = _opts.logd || dummyFunction;
        opts.loge = _opts.loge || dummyFunction;
        opts.permittedMode = _opts.permittedMode ? true : false;
        opts.mode = _opts.mode ? _opts.mode : filterMode.URL;
    }
    logd = opts.logd;
    loge = opts.loge;
    mode = opts.mode;


    this.reload = function(_rules, _opts) {
        opts.permittedMode = _opts.permittedMode ? true : false;
        var res = rulesValidator(_rules);
        if (res.err) {
            loge("rules file contain error: " + JSON.stringify(res.err));
            return null;
        } else {
            rules = res;
            return self;
        }
    };

    this.getRules = function() {
        return JSON.parse(JSON.stringify(rules));
    };

    this.useHandler = function(req, res, next) {
        logd(req.url);
        var params;
        // console.log(req.headers)
        // console.log(req.body)
        if (mode === filterMode.URL) {
            params = req.query;
        } else if (mode === filterMode.BODY) {
            params = req.body;
        }

        var objByRestify = {
            path: path.resolve(req.path()),
            parameters: params,
            headers: req.headers
        };
        var objByUs = urlParse(req.url);
        var checkRes;
        //logd("objByRestify " + JSON.stringify(objByRestify));
        //logd("objByUs      " + JSON.stringify(objByUs));
        if (true /*JSON.stringify(objByRestify) === JSON.stringify(objByUs)*/ ) {
            checkRes = checker(rules, objByRestify, mode);
            if (checkRes) {
                loge("url " + req.url + " cannot not pass parameters validation " + JSON.stringify(checkRes));
                console.log("opts.permittedMode: " + opts.permittedMode);
                if (opts.permittedMode) {
                    next();
                } else if (opts.badRequestHandler) {
                    opts.badRequestHandler(req, res, next, checkRes);
                } else {
                    res.header('Cache-Control', 'no-cache');
                    res.header('Connection', 'close');
                    res.header('Content-Type', 'text/html');
                    res.statusCode = 412;
                    res.end("<html><body><h1>412 Forbidden</h1>Request forbidden by parser rules.</body></html>");
                }
            } else {
                next();
            }
        } else {
            loge("url " + req.url + " cannot not been validated");
            if (opts.permittedMode) {
                next();
            } else if (opts.badRequestHandler) {
                opts.badRequestHandler(req, res, next, checkRes);
            } else {
                res.header('Cache-Control', 'no-cache');
                res.header('Connection', 'close');
                res.header('Content-Type', 'text/html');
                res.statusCode = 400;
                res.end("<html><body><h1>403 Forbidden</h1>Your browser sent an invalid request.</body></html>");
            }
        }
    };

    this.reload(_rules, _opts);

    var urlParse = function(url) {
        try {
            var re = new RegExp('(.*)\\?(.*)');
            var obj = re.exec(url);
            var urlPath, parameterString, parameters = {};
            if (obj === null) {
                urlPath = url;
                parameters = {};
            } else {
                urlPath = obj[1];
                parameterString = obj[2];
                var parameterAndValueArr = parameterString.split("&");
                var validatedPairs = [];
                //logd("path " + path + " parameterAndValueArr: " + JSON.stringify(parameterAndValueArr));
                parameterAndValueArr.forEach(function(parameterAndValue) {
                    var name, value;
                    var substrings = parameterAndValue.split("=");
                    //logd("substrings: " + JSON.stringify(substrings));
                    if (substrings.length === 2) {
                        validatedPairs.push({
                            key: decodeURIComponent(substrings[0]),
                            value: decodeURIComponent(substrings[1])
                        });
                    }
                });
                var validatedHash = _.groupBy(validatedPairs, function(item) {
                    return item.key;
                });
                parameters = _.mapObject(validatedHash, function(item) {
                    if (item.length === 1) {
                        return item[0].value;
                    } else {
                        return _.map(item, function(item) {
                            return item.value;
                        });
                    }
                });
            }
            var res = {
                path: path.resolve(urlPath),
                parameters: parameters
            };
            logd("urlParse return: " + JSON.stringify(res));
            return res;
        } catch (e) {
            loge("urlParse exception: " + JSON.stringify(e));
            return null;
        }
    };

    var checker = function(rules, obj, mode) {
        var found, res;
        //logd("checker path ", JSON.stringify(obj));
        found = rules.hash.indexOf(obj.path);
        if (found !== -1) {
            if (mode === filterMode.URL) {
                var constraints = rules.rules[found].constraints || {};
                // console.log(obj.parameters , '   ' , constraints, '   ' , validate.isEmpty(constraints))
                if (validate.isEmpty(constraints) && !validate.isEmpty(obj.parameters)) {
                    return "missing constraints to validate parameters"
                }

                if (constraints) {
                    try {
                        res = validate(obj.parameters, rules.rules[found].constraints) || {};
                    } catch (err) {
                        return err.toString();
                    }
                    //logd(obj.path + " validate return ", res);

                    for (var attrname in obj.parameters) {
                        if (rules.rules[found].constraints[attrname] === undefined) {
                            res[attrname] = "parameter is not in whitelist";
                        }
                    }
                }

                var headerConstraints = rules.rules[found].headerConstraints;

                if (headerConstraints) {
                    for (var attrname in headerConstraints) {
                        try {
                            var singleRes = validate.single(obj.headers[attrname], headerConstraints[attrname]);
                        } catch (err) {
                            return err.toString();
                        }
                        if (singleRes) {
                            res[attrname] = singleRes;
                        }
                    }
                }

                return validate.isEmpty(res) ? undefined : res;

            } else if (mode === filterMode.BODY) {
                var bodyConstraints = rules.rules[found].bodyConstraints;
                if (!bodyConstraints && !validate.isEmpty(obj.parameters)) {
                    return "missing bodyConstraints to validate parameters"
                }

                if (!validate.isEmpty(bodyConstraints)) {
                    try {
                        res = validate(obj.parameters, rules.rules[found].bodyConstraints) || {};
                    } catch (err) {
                        return err.toString();
                    }
                    // console.log(res)
                    // console.log(obj.parameters)
                    // console.log(rules.rules[found].bodyConstraints)
                    for (var attrname in obj.parameters) {
                        if (rules.rules[found].bodyConstraints[attrname] === undefined) {
                            res[attrname] = "parameter is not in whitelist";
                        }
                    }
                }

                return validate.isEmpty(res) ? undefined : res;
            } else {
                return "internal error";
            }
        } else {
            found = null;
            rules.regex.forEach(function(rule) {
                //logd("checker rule ", rule);
                let frule = rule.re.exec(obj.path);
                //logd("checker p " + obj.path + " found ", frule);
                if (frule) {
                    found = frule;
                }
            });
            return found ? undefined : {
                path: "path is not in whitelist"
            };
        }
    };

};

var rule_constraints = {
    path: {
        "presence": true
    },
    constraints: {},
    regex: {}
};

var rulesValidator = function(rules) {
    var resRules = [];
    var resErrors = [];
    var hashPaths = [];
    var resRegex = [];
    if (validate.isArray(rules)) {
        rules.forEach(function(rule) {
            var ruleRes = validate(rule, rule_constraints);
            if (ruleRes) {
                resErrors.push({
                    rule: rule,
                    err: ruleRes
                });
            } else if (rule.regex) {
                rule.re = new RegExp(rule.path);
                resRegex.push(rule);
            } else {
                if (hashPaths.indexOf(rule.path) !== -1) {
                    resErrors.push({
                        rule: rule,
                        err: "duplicate path"
                    });
                } else {
                    resRules.push(rule);
                    hashPaths.push(rule.path);
                }
            }
        });
        if (validate.isEmpty(resErrors)) {
            return {
                hash: hashPaths,
                rules: resRules,
                regex: resRegex
            };
        } else {
            return {
                err: resErrors
            };
        }
    } else {
        return {
            err: "rules is not array"
        };
    }
};

module.exports = {
    filter: job,
    mode: filterMode
}
