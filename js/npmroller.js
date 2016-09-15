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
    return path.split('/')[0];
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
    var configjs = options.configjs;
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
    return rollup.rollup({
      entry: entryName,
      external: options.external,
      plugins:[{
        resolveId: function(importee, importer){
          return new Promise(function(resolve, reject){
            if(!importer) {
              resolve(importee);
              return;
            }
            var id, version='', baseModule;
            if(!importee.startsWith('.')){
              if(importee in preferredVersions){
                version = '@' + preferredVersions[importee];
              }
              id = importee + version+'/index.js';
            } else {
              id = resolveRelativePath(importee, importer);
            }
            if(!id.endsWith('.js')){
              id+='.js';
            }

            // just in the rare case that packages get updated while rollup is running, lock in version numbers
            baseModule = parseBaseModule(id);
            if(baseModule in versionDirectory){
              resolve(replaceModuleVersion(id, versionDirectory[baseModule]));
            } else {
              updateMessage("Retrieving package information for: "+baseModule);
              npmloader.retrieveModulePackage(baseModule, null, function(err, info){
                if(err){
                  reject(err);
                } else {
                  updateMessage("Received package information for: "+baseModule);
                  versionDirectory[baseModule] = info.version;
                  versionDirectory[info.version] = info.version;
                  resolve(replaceModuleVersion(id, info.version));
                }
              })
            }

            // alternatively, if locking in is not needed:
            // resolve(id);
          });
        },
        load: function (id) {
          return new Promise(function(resolve, reject){
            if(id===entryName){
              resolve(options.configjs);
            } else {
              if(id in cache){
                resolve(cache[id]);
              }
              updateMessage("Retrieving file: " + id);
              npmloader.retrieveFile(npmloader.baseUrl + id, function(error, text){
                if(error){
                  reject(error)
                } else {
                  updateMessage("Received file: "+id);
                  cache[id] = text;
                  resolve(text);
                }
              });
            }
          });
        }
      }]
    })
  };
	return npmroller;
}));