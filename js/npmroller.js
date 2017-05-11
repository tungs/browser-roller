// npmroller alpha; probably buggy
// Copyright (c) Steve Tung All Rights Reserved

(function(root, factory){
	var moduleName = 'npmroller';
	if(typeof define === 'function' && define.amd){
		define(['rollup',  'semver', 'npmloader'], function (rollup) {
			return (root[moduleName] = factory(rollup));
		});
	} else if(typeof module ==='object' && module.exports){
		module.exports = (root[moduleName] = factory(require('rollup'), require('semver'), require('./npmloader')));
	} else {
		root[moduleName] = factory(root['rollup'], root['semver'], root['npmloader']);
	}
}(this, function(rollup, semver, npmloader){
  "use strict";
	var npmroller = {};
  var entryName = 'main.js';
  var cache = {};
  var versionDirectory = {};

  var parseBaseModule = function(path){
    return path.split('/')[0]; // returns "module@version", if there's a version, otherwise "module"
  };

  var parseFilepath = function(path){
    return path.split('/').splice(1).join('/');
  };

  var replaceModuleVersion = function(path, version){
    var baseModule = parseBaseModule(path);
    var filepath = parseFilepath(path);
    return baseModule.split('@')[0] + (version ? "@"+version : "")+"/"+filepath;
  };

  var resolveRelativePath = function(to, from){
    var parts = from.split('/');
    parts.pop();
    parts = parts.concat(to.split('/'));
    var i = 0;
    while(i<parts.length){
      if(parts[i]==='.'){
        parts.splice(i, 1);
      } else if(parts[i]==='..'){
        parts.splice(i-1, 2);
        i--;
      } else {
        i++;
      }
    }
    return parts.join('/');
  };

  var getModuleInfo = function (baseModule) {
    if (versionDirectory[baseModule]) {
      return Promise.resolve(versionDirectory[baseModule]);
    }
    return npmloader.retrieveModulePackage(baseModule, null).then(function (info) {
      var savedInfo = {
        version: info.version,
        dependencies: info.dependencies || {}
      };
      var requestedModuleParts = baseModule.split('@');
      var moduleName = requestedModuleParts[0];
      var requestedVersion = requestedModuleParts.length > 1 ? requestedModuleParts[1] : null;
      versionDirectory[baseModule] = savedInfo;
      if (requestedVersion !== info.version) {
        versionDirectory[moduleName + '@' + info.version] = savedInfo;
      }
      return savedInfo;
    });
  };

  var generateConfigFromExports = function(exportSymbols){
    // exportSymbols are in {"moduleName":["symbol1", "symbol2"..]} format
    var blocks = [];
    var moduleName;
    for (moduleName in exportSymbols) {
      if(exportSymbols.hasOwnProperty(moduleName)){
        blocks.push("export {\n  " + exportSymbols[moduleName].join(",\n  ") + "\n} from \"" + moduleName + "\";");
      }
    }
    return blocks.join("\n\n");
  };
  npmroller.generateConfigFromExports = generateConfigFromExports;

  npmroller.roll = function (options) {
    options = options || {};
    var configjs = options.configjs || options.symbols || undefined;
    if (configjs === undefined) {
      return Promise.reject(new Error("Need to specify a configjs in roller"));
    }
    if(typeof configjs === typeof {}){
      configjs = generateConfigFromExports(configjs);
    }
    var updateMessage = function (message) {
      if (message.type==='warning') {
        console.warn(message.message);
      }
      if(options.messenger){
        options.messenger(message);
      }
    };
    var preferredVersions = options.preferredVersions || {};
    var workingVersions = {};

    var resolveId = function (importee, importer) {
      if (!importer) {
        return importee;
      }
      var importerModule, dependencies;
      var ret; // variable to hold last promise of our chain
      if (importee.startsWith('.')) {
        ret = Promise.resolve(resolveRelativePath(importee, importer));
      } else { // importing a different module
        // check if there are any current dependency violations
        importerModule = parseBaseModule(importer);
        if (versionDirectory[importerModule]) {
          // this should always be the case for external modules
          // the version directory should have been loaded in a previous iteration
          dependencies = versionDirectory[importerModule].dependencies;
          if(dependencies[importee]){
            // there's a dependency defined in the module's package.json
            if (workingVersions[importee]) {
              // there's already a working version
              if(!semver.satisfies(workingVersions[importee], dependencies[importee])){
                // dependency violation!
                updateMessage({type:'warning', message: 'Dependency violation of module '+importee+'@' + workingVersions[importee] + ' with ' +importer + '\'s dependencies (v'+dependencies[importee]+')'});
                // this means we'll have multiple versions floating around
                ret = Promise.resolve(dependencies[importee]);
              }
              ret = Promise.resolve(workingVersions[importee]);
            } else {
              // no current version
              if (importee in preferredVersions) {
                // There's both a preferredVersion and a dependency
                // Since dependencies and preferredVersions can both be ranges, using semver.satisfies() may not work.
                // Instead, combine both the preferredVersion and dependency in the request, and let unpkg figure it out
                ret = npmloader.retrieveModulePackage(importee,
                  preferredVersions[importee] + ' ' +dependencies[importee]).then(function (info) {
                      return info.version;
                    }).catch(function (err) {
                      if(err instanceof npmloader.NotFoundError) {
                        // not found!
                        updateMessage({
                          type:'warning',
                          message: 'Could not find a version of the package '+importee+' that satisfies both ' + preferredVersions[importee] + ' and ' + dependencies[importee]
                        });
                      }
                      return dependencies[importee];
                    });
              } else {
                ret = Promise.resolve(dependencies[importee]);
              }
            }
          } else {
            // no dependency information found in the module's package.json
            updateMessage({
              type:'warning',
              message: "No dependency information for " + importee + " found in "+importerModule +"'s package.json"
            });
            ret = Promise.resolve(workingVersions[importee] || preferredVersions[importee] || '');
          }
        } else {
          if (importerModule !== entryName) {
            // this should not happen; versionDirectory[baseImporterModule] should have been defined at an earlier iteration-- when the importer module was initially fetched
            console.warn("versionDirectory['"+importerModule+"'] is not populated!");
          }
          ret = Promise.resolve(workingVersions[importee] || preferredVersions[importee] || '');
        }
        // ret should be resolved to the current version
        ret = ret.then(function (version) {
          return importee + (version ? '@' + version : '')+'/index.js';
        });
        // now ret is working with 'id' (the filepath)
      }

      return ret.then(function (id) {
        if (!id.endsWith('.js')) {
          id += '.js';
        }
        var baseModule = parseBaseModule(id);
        updateMessage({type: 'status', message: 'Retrieving package information for: '+baseModule});
        return getModuleInfo(baseModule)
          .catch(function (err) {
            if(err instanceof npmloader.NotFoundError) {
              updateMessage({type: 'warning', message: 'Could not find module ' + baseModule + '... loading latest version instead'});
              baseModule = baseModule.split('@')[0];
              return getModuleInfo(baseModule);
            } else {
              throw err;
            }
          }).then(function (info) {
            updateMessage({type: 'status', message: 'Retreived package information for: ' + baseModule});
            var moduleName = baseModule.split('@')[0];
            workingVersions[moduleName] = info.version;
            return replaceModuleVersion(id, info.version);
          }).catch(function(err){
            updateMessage({type: 'warning', message: 'Error: '+err});
            throw err;
          })
      });
    };

    return rollup.rollup({
      entry: entryName,
      external: options.external,
      plugins:[{
        resolveId: resolveId,
        load: function (id) {
          if (id === entryName) {
            return configjs;
          } else {
            if(id in cache){
              return cache[id];
            } else {
              updateMessage({type: "status", message: "Retrieving file: " + id});
              return npmloader.retrieveFile(npmloader.baseUrl+id).then(function(text){
                cache[id] = text;
                updateMessage({type: "status", message: "Retrieved file: " + id});
                return text;
              });
            }
          }
        }
      }]
    })
  };

	return npmroller;
}));
