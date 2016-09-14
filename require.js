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
		//return a promise which 
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
	//require call, which exports to window.require
	this.require = function(src) {
		//if it is in the loaded map, it was already preloaded
		//otherwise, we must preload it, and all of it's dependencies
		if (loaded[src])
			return loaded[src];
		//check to see if we are loading css
		if (src.includes(".css"))
			return requireCss(src);
		//set loaded to a promise which resolves when the module is loaded
		loaded[src] = new Promise((resolve, reject) => {
			//load the module
			load(src).then((result) => {
				//get the requirements
				let reqs = getRequirements(result);
				//call require on all requirements, and
				//when done, resolve with the value of the module export
				Promise.all(reqs.map(require)).then(() => {
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
	requireCss = function(src) {
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
	Object.freeze(require);
})();

