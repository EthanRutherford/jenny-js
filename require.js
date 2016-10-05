(() => {
	//map of all loaded modules
	const loaded = {};
	//Regex for getting requirements comment
	const requirementsRegex = /\/\*\s*requirements((?:\s|\S)*?)\*\//;
	const splitRegex = /\S+/g;
	//reads the source for requirements
	function getRequirements(code) {
		let reqs = (code.match(requirementsRegex) || [])[1] || "";
		return reqs.match(splitRegex) || [];
	}
	//executes the code, and returns the result of module.exports
	function execute(code) {
		let module = {};
		(new Function("module", code)).call(null, module);
		return module.exports;
	}
	//call to load the resource
	function load(src) {
		//return a promise which resolves with the module exports
		return new Promise((resolve, reject) => {
			let request = new XMLHttpRequest();
			request.open("get", src);
			request.onload = () => {
				if (request.status === 200) {
					resolve(request.response);
				} else {
					reject(Error("Module failed to load, status: " + request.statusText));
				}
			}
			request.onerror = () => {
				reject(Error("Module failed to load due to network error"));
			}
			request.send();
		});
	}
	//require a javascript file
	function requireJs(src) {
		//if it is in the loaded map, it was already preloaded
		//otherwise, we must preload it, and all of it's dependencies
		if (loaded[src])
			return loaded[src];
		//set loaded to a promise which resolves when the module is loaded
		loaded[src] = new Promise((resolve, reject) => {
			//load the module
			load(src).then((result) => {
				//get the requirements
				let reqs = getRequirements(result);
				//call require with relative path on all requirements, and
				//when done, resolve with the value of the module export
				Promise.all(reqs.map((req) => requireCore(req, src))).then(() => {
					loaded[src] = execute(result);
					resolve(loaded[src]);
				}).catch((error) => {
					reject(error);
				});
			}).catch((error) => {
				reject(error);
			});
		});
		return loaded[src];
	}
	//require a css file
	function requireCss(src) {
		//if a link with that name exists, return true
		if (document.querySelectorAll("a[href='" + src + "']").length)
			return true;
		//otherwise, return a promise that resolves when the css is loaded
		return new Promise((resolve, reject) => {
			var link = document.createElement("link");
			link.rel = "stylesheet";
			link.type = "text/css";
			link.href = src;
			document.head.appendChild(link);
			link.onload = () => {
				resolve(true);
			}
			link.onerror = (event) => {
				reject(event);
			}
		});
	}
	//call to parse urls
	function parseUrl(src, relativeTo) {
		//create a url out of the source
		let url = new URL(src, relativeTo);
		//make sure the location matches the current domain
		if (url.hostname !== this.location.hostname)
			throw new Error(`require refused to load cross domain resource '${src}'`);
		return url.origin + url.pathname;
	}
	//the recursive inner require call
	function requireCore(src, relativeTo) {
		//parse the url
		let url = parseUrl(src, relativeTo);
		//check to see if we are loading css
		if (src.includes(".css"))
			return requireCss(url);
		//else loading javascript
		return requireJs(url);
	}
	//external require call, which exports to window.require
	this.require = function(src) {
		//call the worker function, with relativeTo set to webroot
		return requireCore(src, this.location.origin);
	}
	//disallow modifying require
	Object.freeze(this.require);
})();

