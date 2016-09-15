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
  var unpkgBaseUrl = "https://unpkg.com/";
  npmloader.baseUrl = unpkgBaseUrl;

  var moduleList = [];
  var modules = {};
  var cache = {};

  var addCallback = function(p, callback){
    return callback ? p.then(function(data){ callback(null, data); }, function(err){ callback(err, null); }) : p;
  };
  npmloader.addCallback = addCallback;

  var generateModuleUrl = function(moduleName, version){
    return unpkgBaseUrl + moduleName + (version ? '@' + version : '');
  };
  npmloader.generateModuleUrl = generateModuleUrl;

  var retrieveFile = function(fileUrl, callback){
    console.log("Retrieving: "+fileUrl);
    var request;
    var cancel = false;
    var ret;

    var ret = addCallback(new Promise(function(resolve, reject){
      var requestFile = function(){
        if(npmloader._cache && fileUrl in cache){
          resolve(cache[fileUrl]);
          return;
        }
        request = fileDownloader(fileUrl, function(error, text){
          if(error) // should have finer error handling
          {
            console.warn("Error Requesting File " + fileUrl, error);
            if(!cancel) {
              reject(error);
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
              resolve(text);
            } else {
              reject(new Error("Request to "+fileUrl+" canceled"));
            }
          }
        });
      }
      requestFile();
    }), callback);

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

  var NotFoundError = function(message) {
    this.message = message;
    this.stack = (new Error()).stack;
  }

  NotFoundError.prototype = Object.create(Error.prototype);
  NotFoundError.prototype.name = 'FileNotFoundError';
  NotFoundError.prototype.constructor = NotFoundError;
  npmloader.NotFoundError = NotFoundError;

  var retrieveJSON = function(fileUrl, callback){
    return addCallback(retrieveFile(fileUrl)
      .then(function(text){
        var ret = null;
        try {
          ret = JSON.parse(text);
        } catch(e) {
          throw new NotFoundError(fileUrl + " was not found!");
        }
        return ret;
      }), callback);
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

  var isArray = (Array && Array.isArray) ? Array.isArray : function(obj){
    return Object.prototype.toString(obj) === "[object Array]"; // this does not work in Node!
  };

  var resolveToModuleList = function(obj){
    var moduleList = [], key;
    if(isArray(obj)){
      moduleList = obj.map(function(item){
        return typeof item === 'string' ? {name: item, version: null} : item;
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
              });
            }
          }
        }
      }
    }
    return symbols;
  };

  var retrieveModuleExports = function(moduleName, version, callback){
    return addCallback(retrieveModuleFile(moduleName, version, 'index.js').then(parseExportSymbols), callback);
  };
  npmloader.retrieveModuleExports = retrieveModuleExports;

  var retrieveModuleInfo = function(moduleName, version, callback){
    return addCallback(Promise.all([retrieveModulePackage(moduleName,version), retrieveModuleExports(moduleName,version)]).then(function(data){
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
    }), callback);
  };
  npmloader.retrieveModuleInfo = retrieveModuleInfo;


  var retrieveModulesInfo = function(moduleList, callback){
    return addCallback(Promise.all(moduleList.map(function(module){
      return retrieveModuleInfo(module.name, module.version);
    })), callback);
  };
  npmloader.retrieveModulesInfo = retrieveModulesInfo;

	return npmloader;
}));