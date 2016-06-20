var fs = require("fs");
var infoLoader = require("../js/d3InfoLoader.js");
infoLoader.loadModulesInfo({"d3-scale-chromatic": "latest"}, function(error, info){
	fs.writeFile(__dirname+"/../data/d3Info.json", JSON.stringify(info, null, "  "));
});