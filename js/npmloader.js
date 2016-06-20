// npmloader prealpha; probably buggy
// Copyright (c) Steve Tung All Rights Reserved

(function(root, factory){
	var moduleName = 'npmloader';
  var node_https, node_url, node_downloader;
	if(typeof define === "function" && define.amd){
		define(["d3","esprima"],function(d3, esprima){
			return (root[moduleName] = factory(d3.text, esprima));
		});
	} else if(typeof module ==="object" && module.exports){    
    node_https = require("https");
    node_url = require("url");
    node_downloader = function(url, callback){
      node_https.get(url, function(response){
        var redirectUrl;
        var messageArray=[];
        if(response.statusCode === 200) {
          response.on('data', function(chunk){
            messageArray.push(chunk);
          });
          response.on('end', function(){
            callback(null, messageArray.join(''));
          });
        } else if(response.statusCode >= 300 && response.statusCode < 400) {
          redirectUrl = node_url.parse(url).protocol + "//" + node_url.parse(url).host + response.headers.location;
          console.log('redirecting', redirectUrl);
          node_downloader(redirectUrl, callback);
        }
      }).on('error', function(error){
        callback(error, null);
      }).end();      
    };
		module.exports = (root[moduleName] = factory(node_downloader, require("esprima")));
	} else {
		root[moduleName] = factory(root["d3"].text, root["esprima"]);
	}
}(this, function(fileDownloader, esprima){
	var npmloader = {};
  var npmCDNBaseUrl = "https://npmcdn.com/";
  npmloader.baseUrl = npmCDNBaseUrl;

  var moduleList = [];
  var modules = {};
  var cache = {};

  var generateModuleUrl = function(moduleName, version){
    return npmCDNBaseUrl + moduleName + (version ? '@' + version : '');
  };
  npmloader.generateModuleUrl = generateModuleUrl;

  var retrieveFile = function(fileUrl, callback){
    console.log("Retrieving: "+fileUrl);
    var request;
    var cancel = false;
    var requestFile = function(){
      if(fileUrl in cache){
        callback(null, cache[fileUrl]);
        return;
      }
      request = fileDownloader(fileUrl, function(error, text){
        if(error) // should have finer error handling
        {
          console.log("Error Requesting File " + fileUrl, error);
          if(!cancel) {
            callback(error, null);
/*
            console.log("Retrying in 60 seconds");
            setTimeout(requestFile, 60000);
*/
          }
        } else {
          cache[fileUrl] = text;
          if(!cancel){
            callback(error, text);
          }
        }
      });
    }
    requestFile();
    return {
      cancel: function(){
        cancel = true;
        if(request){
          request.abort();
        }
      },
      getXHR: function(){
        return request;
      }
    }  
  };
  npmloader.retrieveFile = retrieveFile;

  var retrieveJSON = function(fileUrl, callback){
    return retrieveFile(fileUrl, function(error, text){
      callback(error, text ? JSON.parse(text) : null);
    });
  };
  npmloader.retrieveJSON = retrieveJSON;


  var retrieveModuleFile = function(moduleName, version, filepath, callback){
    return retrieveFile(generateModuleUrl(moduleName, version) + '/'+ filepath, callback);
  };
  npmloader.retrieveModuleFile = retrieveModuleFile;

  var retrieveModuleJSON = function(moduleName, version, filepath, callback){
    return retrieveJSON(generateModuleUrl(moduleName, version) + '/'+ filepath, callback);
  };
  npmloader.retrieveModuleJSON = retrieveModuleJSON;

  var retrieveModulePackage = function(moduleName, version, callback){
    return retrieveModuleJSON(moduleName, version, 'package.json', callback)
  };
  npmloader.retrieveModulePackage = retrieveModulePackage;

  var retrieveModuleDirectory = function(moduleName, version, callback){
    return retrieveJSON(generateModuleUrl(moduleName, version) + '/?json', callback);
  };
  npmloader.retrieveModuleDirectory = retrieveModuleDirectory;

  var retrieveModuleJS = function(moduleName, version, callback){
    var filepaths = [];
    var filesToLoad = 0;
    var moduleCode = {};
    var walkDirectory = function(directory){
      var i, path;
      for(i=0; i<directory.files.length; i++){
        path = directory.files[i].path;
        if(directory.files[i].type==="directory"){ 
          //if(!path.endsWith('/build')
          walkDirectory(directory.files[i]);
        } else if(path.endsWith('.js')){ // alternatively check if files[i].contentType==="application/javascript"
          filepaths.push(path);
        }
      }
    };
    var loadCode = function(filepath, name, cb){
      retrieveFile(filepath, function(err, code){
        moduleCode[name] = code;
        cb(err, code);
      });
    };
    retrieveModuleDirectory(moduleName, version, function(error, directory){
      var i;
      var hasError = false;
      walkDirectory(directory);
      filesToLoad = filepaths.length;
      for(i=0; i<filepaths.length; i++) {
        loadCode(generateModuleUrl(moduleName, version) + filepaths[i], filepaths[i], function(err, code){
          if(hasError){
            return;
          }
          if(err){
            hasError = true;
            callback(err, null);
          }
          filesToLoad--;
          if(!filesToLoad){
            callback(err, {name: moduleName, version: version, files: moduleCode});
          }
        });      
      }
    });
  };
  npmloader.retrieveModuleJS = retrieveModuleJS;

  var iterateList = function(list, iteration, itemCallback, callback){
    var toLoad = list.length, i, hasError = false;
    var loaded = function(ind, queryItem){
      return function(err){
        if(hasError){
          return;
        }
        if(err){
          hasError = true;
          callback(err);
        }
        itemCallback.apply(this, [ind, queryItem].concat(Array.prototype.slice.call(arguments, 1)));
        toLoad--;
        if(!toLoad){
          callback(err);
        }
      };
    }
    for(i=0;i<list.length;i++){
      iteration(list[i], loaded(i, list[i]));
    };
  };

  var isArray = (Array && Array.isArray) ? Array.isArray : function(obj){
    return Object.prototype.toString(obj) === "[object Array]"; // this does not work in Node!
  };

  var resolveToModuleList = function(obj){
    var moduleList = [], key;
    if(isArray(obj)){
      moduleList = obj.map(function(item){
        if(typeof item === 'string'){
          return {name: item, version: null}
        } else {
          return item;
        }
      });
    } else if(typeof obj === typeof {}){
      for(key in obj){
        if(obj.hasOwnProperty(key)){
          moduleList.push({name: key, version: obj[key]});
        }
      }
    }
    return moduleList;
  };
  npmloader.resolveToModuleList = resolveToModuleList;

  var iterateModuleList = function(moduleObj, moduleProcessor, callback){
    var moduleList = resolveToModuleList(moduleObj);
    var modules = [];
    return iterateList(moduleList, function(listItem, cb){
      moduleProcessor(listItem, cb);
    }, function(ind, queryItem, retrievedItem){
      modules[ind] = retrievedItem;
    }, function(err){
      callback(err, modules);
    });
  };

  var retrieveModulesJS = function(moduleList, callback){
    return iterateModuleList(moduleList, function(listItem, cb){
      retrieveModuleJS(listItem.name, listItem.version, cb);
    }, callback);
  };
  npmloader.retrieveModulesJS = retrieveModulesJS;

  var parseExportSymbols = function(src) {
    var symbols = [];
    var prog = esprima.parse(src, { sourceType: 'module'});
    var i, j, specifiers;
    for(i=0; i<prog.body.length; i++){
      if(prog.body[i].type === 'ExportNamedDeclaration'){
        specifiers = prog.body[i].specifiers;
        if(specifiers && specifiers.length){
          for(j=0; j<specifiers.length; j++){
            if(specifiers[j].type==='ExportSpecifier'){
              symbols.push({
                name: specifiers[j].exported.name,
                local: specifiers[j].local.name,
                from: prog.body[i].source.value
              })
            }
          }
        }
      }
    }
    return symbols;
  };

  var retrieveModuleExports = function(moduleName, version, callback){
    retrieveModuleFile(moduleName, version, 'index.js', function(err, text){
      if(err){
        callback(err, null);
      } else {
        callback(err, parseExportSymbols(text));
      }
    });
  };
  npmloader.retrieveModuleExports = retrieveModuleExports;

  var retrieveModuleInfo = function(moduleName, version, callback){
    var info = {};
    var hasError = false;
    var toLoad = 2;
    var cbgen = function(processor) {
      return function(err, data){
        if(hasError){
          // calback already called
          return;
        }
        if(err){
          hasError = true;
          callback(err, null);
          return;
        }
        processor(data);
        toLoad--;
        if(!toLoad){
          callback(err, info);
        }        
      }
    };

    retrieveModulePackage(moduleName, version, cbgen(function(pack){
      var key;
      for(key in pack){
        if(pack.hasOwnProperty(key)){
          info[key] = pack[key];
        }
      }
    }));

    retrieveModuleExports(moduleName, version, cbgen(function(symbols){
      info.exportSymbols = symbols.map(function(item){
        return item.name;
      });
    }));
  };
  npmloader.retrieveModuleInfo = retrieveModuleInfo;

  var retrieveModulesInfo = function(moduleList, callback){
    return iterateModuleList(moduleList, function(listItem, cb){
      retrieveModuleInfo(listItem.name, listItem.version, cb);
    }, callback);
  };
  npmloader.retrieveModulesInfo = retrieveModulesInfo;

  var compareVersions = function(a, b){
    // TODO: rethink how to compare nonspecific versions of modules (e.g. "~1.0.0"; ">=0.8.2"; etc)
    var i = 0;
    a = a.split('.');
    b = b.split('.');
    for(i=0; i < Math.max(a.length, b.length); i++){
      if(i >= a.length && +b[i]>0){
        return -1;
      } else if(i >= b.length && +a[i]>0){
        return 1;
      }
      if(i < a.length && i < b.length && +a[i] !== +b[i]){
        return +a[i]-b[i];
      }
    }
    return 0;
  };
  npmloader.compareVersions = compareVersions;

  var modulesToLoad = 0;
  var loadModuleDependencies = function(dependencies, callback){
    var moduleName;
    for(moduleName in dependencies){
      if(dependencies.hasOwnProperty(moduleName)){
        loadModuleAndDependencies(moduleName, dependencies[moduleName], callback);
      }
    }
  };
  npmloader.loadModuleDependencies = loadModuleDependencies;

  var loadModuleAndDependencies = function(moduleName, version, callback){
    var m;
    if(moduleName in modules){ // a previous module was already loaded or is loading
      if(compareVersions(modules[moduleName].version, version) >= 0) {
        // previous load is fine
          callback();
        return;
      } else {
        // cancel the previous request, and count it as loaded
        console.log('Canceling Request', modules[moduleName].version, version);
        modules[moduleName].request.cancel();
        modulesToLoad--;
      }
    } 
    m = {
      name: moduleName,
      version: version,
      loaded: false
    }
    moduleList.push(m);
    modules[moduleName] = m;
    modulesToLoad++;
    m.request = retrieveJSON(generateModuleUrl(m.name, m.version) + '/package.json', function(error, package){
      console.log(package);
      loadModuleDependencies(package.dependencies, callback);
    });
  };
  npmloader.loadModuleAndDependencies = loadModuleAndDependencies;

	return npmloader;
}));