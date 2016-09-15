(function(root, factory){
  var moduleName = 'd3InfoLoader';
  if(typeof define === "function" && define.amd){
    define(["npmloader"],function(rollup){
      return (root[moduleName] = factory(rollup));
    });
  } else if(typeof module ==="object" && module.exports){
    module.exports = (root[moduleName] = factory(require("./npmloader")));
  } else {
    root[moduleName] = factory(root["npmloader"]);
  }
}(this, function(npmloader){
  var mainPackageUrl = "https://unpkg.com/d3@latest/package.json";
  var d3InfoLoader = {};

  var loadCoreModulesList = function(callback){
    npmloader.retrieveJSON(mainPackageUrl, function(err, mainPackage){
      callback(err, mainPackage ? mainPackage.dependencies : mainPackage);
    });
  };

  var loadLongModulesInfo = function(additionalModules, callback){
    loadCoreModulesList(function(err, mainModules){
      var modules;
      if(err){
        callback(err, null);
      } else{
        modules = npmloader.resolveToModuleList(mainModules).concat(npmloader.resolveToModuleList(additionalModules));
        npmloader.retrieveModulesInfo(modules, callback);
      }
    });
  };
  d3InfoLoader.loadLongModulesInfo = loadLongModulesInfo;

  var loadModulesInfo = function(additionalModules, callback){
    return loadLongModulesInfo(additionalModules, function(err, longModules){
      var modules;
      if(err){
        callback(err, null);
      } else {
        var modules = longModules.map(function(item){
          var newItem = {
            name: item.name,
            version: item.version,
            exportSymbols: item.exportSymbols
          };
          if(item.dependencies!==undefined){
            newItem.dependencies = item.dependencies;
          }
          return newItem;
        });
        callback(err, modules);
      }
    });
  };
  d3InfoLoader.loadModulesInfo = loadModulesInfo;

	return d3InfoLoader;
}));