// npmroller prealpha; probably buggy
// Copyright (c) Steve Tung All Rights Reserved

(function(root, factory){
	var moduleName = 'npmroller';
	if(typeof define === "function" && define.amd){
		define(["rollup", "npmloader"],function(rollup){
			return (root[moduleName] = factory(rollup));
		});
	} else if(typeof module ==="object" && module.exports){
		module.exports = (root[moduleName] = factory(require("rollup"), require("./npmloader")));
	} else {
		root[moduleName] = factory(root["rollup"], root["npmloader"]);
	}
}(this, function(rollup, npmloader){
	var npmroller = {};
  var entryName = "main.js";
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

  var generateConfigFromExports = function(exportSymbols){
    // exportSymbols are in {"moduleName":["symbol1", "symbol2"..]} format
    var blocks = [];
    for(moduleName in exportSymbols){
      if(exportSymbols.hasOwnProperty(moduleName)){
        blocks.push("export {\n  " + exportSymbols[moduleName].join(",\n  ") + "\n} from \"" + moduleName + "\";");
      }
    }
    return blocks.join("\n\n");
  };
  npmroller.generateConfigFromExports = generateConfigFromExports;

  npmroller.roll = function(options){
    options = options || {};
        var configjs = options.configjs || options.symbols ? generateConfigFromExports(options.symbols) : undefined;
    if(configjs === undefined){
      throw new Error("Need to specify a configjs in roller");
    }
    if(typeof configjs === typeof {}){
      configjs = generateConfigFromExports(configjs);
    }
    var updateMessage = function(message){
      if(options.messenger){
        options.messenger(message);
      }
    };
    var preferredVersions = options.preferredVersions || {};
    var workingVersions = {};

    if(options.symbols && options.resolveDependencies) {
      var module;
      var moduleList = [];
      var dependencyList = {};
      for(module in symbols){
        if(symbols.hasOwnProperty(module)){
          if(module in preferredVersions) {
            moduleList.push({name: module, version: preferredVersions[module]});
          } else {
            moduleList.push({name: module, version: 'latest'});
          }
        }
      }
      Promise.all(moduleList.map(function(module){
        return npmloader.retrieveModuleInfo(module.name, module.version)
      })).then(function(modulesInfo){
        modulesInfo;
      });

    }    
    return rollup.rollup({
      entry: entryName,
      external: options.external,
      plugins:[{
        resolveId: function(importee, importer){
          if(!importer) {
            return importee;
          }
          var id, baseModule, baseImporterModule, dependencies;
          var ret = Promise.resolve(''); // ret starts with version
          if(!importee.startsWith('.')){ // importing a different module
/*
            // check if there are any current dependency violations
            baseImporterModule = parseBaseModule(importer);
            if(versionDirectory[baseImporterModule]){ 
              // this should always be the case-- the version directory should have been loaded in a previous iteration
              dependencies = versionDirectory[baseImporterModule].dependencies;
              if(dependencies[importee]){
                // there's dependency defined in the module's package.json
                if(workingVersions[importee]){
                  // there's already a working version
                  if(semver.satisfies(workingVersions[importee], dependencies[importee])){
                    // no dependency violation
                  } else {
                    // console.warn()
                    // dependency violation!
                  }
                  // in either case, still use the working version:
                  ret = Promise.resolve(workingVersion[importee]);
                } else {
                  // no current working version 
                  if(importee in preferredVersions){ 
                    // There's both a preferredVersion and a dependency
                    // Since dependencies and preferredVersions can both be ranges, using semver.satisfies() may not work.
                    // Instead, combine both the preferredVersion and dependency in the version to request
                    ret = Promise.resolve(preferredVersions[importee] + ' ' +dependencies[importee]); //
                    // possibly check here if there is a violation by requesting the package to see if it exists
                    ret.then(function(version){
                      return new Promise(function(resolve, reject)){
                        npmloader.retrieveModulePackage(importee, version).then(function(info){
                          resolve(version);
                        }).catch(function(err){
                          // not found!
                          if(err instanceof npmloader.NotFoundError) {
  
                          }
                          resolve(dependencies[importee]);
                        });
                      });
                    });
                  } else {
                    ret = Promise.resolve(dependencies[importee]);
                  }

                }
              } else {
                // no dependency information found in the module's package.json
                ret = Promise.resolve(workingVersions[importee] || preferredVersions[importee] || '');
              }
            } else {
              // this should not happen; versionDirectory[baseImporterModule] should have been defined at an earlier iteration-- when the importer module was initially fetched
                ret = Promise.resolve(workingVersions[importee] || preferredVersions[importee] || '');              
            }
            ret.then(function(version){return importee + (version ? '@' + version : '')+'/index.js';}); // now ret is working with 'id' (the filepath)
*/
            if(importee in preferredVersions){
              version = preferredVersions[importee];
            }

            id = importee + (version ? '@' + version : '') + '/index.js';

          } else {
            id = resolveRelativePath(importee, importer);
          }

          if(!id.endsWith('.js')){
            id+='.js';
          }

          return new Promise(function(resolve, reject){

            // just in the rare case that packages get updated while rollup is running, lock in version numbers
            baseModule = parseBaseModule(id);
            if(baseModule in versionDirectory){
              resolve(replaceModuleVersion(id, versionDirectory[baseModule]).version);
            } else {
              updateMessage({type: "status", message: "Retrieving package information for: "+baseModule});
              npmloader.retrieveModulePackage(baseModule, null).then(function(info){
                var savedInfo = {version: info.version, dependencies: info.dependencies};
                updateMessage({type: "status", message: "Received package information for: "+baseModule});
                versionDirectory[baseModule] = savedInfo;
                versionDirectory[info.version] = savedInfo;
                workingVersions[baseModule] = info.version;
                resolve(replaceModuleVersion(id, info.version));
              }).catch(function(err){
                reject(err);
              });
            }

            // alternatively, if locking in is not needed:
            // resolve(id);
          });
        },
        load: function (id) {
          if(id===entryName){
            return configjs;
          } else {
            if(id in cache){
              return cache[id];
            } else {
              updateMessage({type: "status", message: "Retrieving file: " + id});
              return npmloader.retrieveFile(npmloader.baseUrl+id).then(function(text){
                cache[id] = text;
                updateMessage({type: "status", message: "Received file: " + id});
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