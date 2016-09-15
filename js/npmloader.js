// npmloader prealpha; probably buggy
// Copyright (c) Steve Tung All Rights Reserved

(function(root, factory){
	var moduleName = 'npmloader';
  var node_https, node_url, fileDownloader;
  if(typeof process === "object" &&
    typeof process.versions === "object" &&
    process.versions.node !== undefined) {
    // in node environment
    node_https = require("https");
    node_url = require("url");
    fileDownloader = function(url, callback){
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
          fileDownloader(redirectUrl, callback);
        }
      }).on('error', function(error){
        callback(error, null);
      }).end();      
    };
  } else {
    fileDownloader = function(url, callback){
      var xhr = new XMLHttpRequest();
      xhr.onreadystatechange = function () {
        if (xhr.readyState > 3) {
          if((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304){
            callback(null, xhr.responseText);
          } else {
            callback(new Error('Error Requesting '+url+'! Status: '+xhr.status), null);
          }
        }
      };
      xhr.open("GET", url);
      xhr.send();
      return xhr;
    }    
  }

	if(typeof define === "function" && define.amd){
		define(["esprima"],function(esprima){
			return (root[moduleName] = factory(fileDownloader, esprima));
		});
	} else if(typeof module ==="object" && module.exports){    
		module.exports = (root[moduleName] = factory(fileDownloader, require("esprima")));
	} else {
		root[moduleName] = factory(fileDownloader, root["esprima"]);
	}
}(this, function(fileDownloader, esprima){
	var npmloader = {
    _cache: false
  };
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
    var ret;
    var requestFile = function(cb){
      if(npmloader._cache && fileUrl in cache){
        cb(null, cache[fileUrl]);
        return;
      }
      request = fileDownloader(fileUrl, function(error, text){
        if(error) // should have finer error handling
        {
          console.warn("Error Requesting File " + fileUrl, error);
          if(!cancel) {
            cb(error, null);
/*
            console.log("Retrying in 60 seconds");
            setTimeout(requestFile, 60000);
*/
          }
        } else {
          if(npmloader._cache){
            cache[fileUrl] = text;
          }
          if(!cancel){
            cb(error, text);
          }
        }
      });
    }
    if(callback){
      ret = {};
      requestFile(callback);
    } else {
      ret = new Promise(function(resolve, reject){
        requestFile(function(err, data){
          if(err){
            reject(err);
          } else {
            resolve(data);
          }
        });
      });
    }
    ret.cancel = function(){
        cancel = true;
        if(request){
          request.abort();
        }
      };
    ret.getXHR = function(){
        return request;
      }
    return ret;
  };
  npmloader.retrieveFile = retrieveFile;

  var retrieveJSON = function(fileUrl, callback){
    if(callback){
      return retrieveFile(fileUrl, function(error, text){
        callback(error, text ? JSON.parse(text) : null);
      });      
    } else {
      return retrieveFile(fileUrl).then(function(text){
        return text ? JSON.parse(text) : null;
      });
    }
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
    if(callback){
      return retrieveModuleFile(moduleName, version, 'index.js', function(err, text){
        if(err){
          callback(err, null);
        } else {
          callback(err, parseExportSymbols(text));
        }
      });      
    } else {
      return retrieveModuleFile(moduleName, version, 'index.js').then(parseExportSymbols);
    }
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

  var retrieveModuleInfoPromise = function(moduleName, version){
    return Promise.all([retrieveModulePackage(moduleName,version), retrieveModuleExports(moduleName,version)]).then(function(data){
      var info = {}, key, pack = data[0], symbols = data[1];
      for(key in pack){
        if(pack.hasOwnProperty(key)){
          info[key] = pack[key];
        }        
      }
      info.exportSymbols = symbols.map(function(item){
        return item.name;
      });
      return info;
    });
  };
  npmloader.retrieveModuleInfoPromise = retrieveModuleInfoPromise;


  var retrieveModulesInfo = function(moduleList, callback){
    return iterateModuleList(moduleList, function(listItem, cb){
      retrieveModuleInfo(listItem.name, listItem.version, cb);
    }, callback);
  };
  npmloader.retrieveModulesInfo = retrieveModulesInfo;

  var retrieveModulesInfoPromise = function(moduleList){
    return Promise.all(moduleList.map(function(module){
      return retrieveModuleInfoPromise(module.name, module.version);
    }));
  };
  npmloader.retrieveModulesInfoPromise = retrieveModulesInfoPromise;

	return npmloader;
}));