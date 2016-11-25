//# preload ./self.js
const self = require("./self.js").getSelf();

const arrayWrap = (obj) => obj == null ? [] : obj instanceof Array ? obj : [obj];
const isProxy = Symbol();
const isText = Symbol("TextModel");
const rawContent = Symbol();
const dump = Symbol();

//reverse item lookup table
const ModelMap = new WeakMap();

//these coallesce the two versions of getting/setting/deleting an attribute on an element
function getAttr(elem, property) {
	let val = elem[property];
	if (val != null)
		return val;
	return elem.getAttribute(property);
}
function setAttr(elem, property, value) {
	if (!value) {
		delAttr(elem, property);
	} else {
		elem.setAttribute(property, value);
		elem[property] = value;
	}
}
function delAttr(elem, property) {
	elem[property] = null;
	elem.removeAttribute(property);
}

//handlers for event handler prop
function modelOnSetHandler(target, property, value) {
	let me = self(this);
	me._.elem.removeEventListener(property, target[property]);
	me._.elem.addEventListener(property, value);
	target[property] = value;
	return true;
}
function modelOnDelHandler(target, property) {
	let me = self(this);
	me._.elem.removeEventListener(property, target[property]);
	return delete target[property];
}

//handlers for content array
function contentArrayGetHandler(target, property) {
	if (property === isProxy)
		return true;
	if (property === rawContent)
		return target;
	return target[property];
}
function contentArraySetHandler(target, property, value) {
	let me = self(this);
	let i = Number(property);
	if (Number.isInteger(i)) {
		disconnectObserver(me.$);
		//initialize the new value
		value = proxifyModel(value);
		//get the old node
		let oldNode = me._.elem.childNodes[i];
		//and the new node
		let newNode = self(value)._.elem;
		//if the new node existed somewhere, replace it with a placeholder
		//this should hopefully only happen temporarily while moving nodes,
		//one should not absently clone nodes, as the copies are shallow
		if (newNode.parentNode) {
			//define a placeholder node, since nodes are moved, not copied
			let junkNode = document.createTextNode("MOVED ELSEWHERE");
			newNode.parentNode.insertBefore(junkNode, newNode);
			newNode.remove();
			removeRef(value);
		}
		//if there was previously a node at this position, replace it
		//if there wasn't, we must be adding a new one
		if (oldNode) {
			removeRef(target[property]);
			me._.elem.insertBefore(newNode, oldNode);
			oldNode.remove();
		} else {
			me._.elem.appendChild(newNode);
		}
		setRef(me._.owner, value);
		connectObserver(me.$);
	}
	target[property] = value;
	return true;
}
function contentArrayDelHandler(target, property) {
	let me = self(this);
	let i = Number(property);
	if (Number.isInteger(i)) {
		disconnectObserver(me.$);
		//if there is an element at this index, remove it
		let oldNode = me._.elem.childNodes[i];
		if (oldNode) {
			removeRef(target[property]);
			oldNode.remove();
		}
		connectObserver(me.$);
	}
	return delete target[property];
}

//handler for css style
function cssStyleGetHandler(target, property) {
	return target[property];
}
function cssStyleDelHandler(target, property) {
	//deleting is a no op for CssStyleDeclaration, so set it to the empty string instead
	target[property] = "";
	return true;
}

//model callback object literals
const modelHasProps = {
	tag: true,
	on: true,
	class: true,
	style: true,
	content: true,
	computedStyle: true,
	text: true,
	parent: true,
	owner: true,
};

function modelGetAttr({property, me}) {
	let ans = getAttr(me._.elem, property);
	return ans instanceof Function ? undefined : ans;
}
const modelGetCallbacks = {
	[isProxy]: () => true,
	[isText]: ({target}) => target[isText],
	[rawContent]: ({target}) => target.content,
	tag: ({target}) => target.tag,
	on: ({target}) => target.on,
	class: ({target}) => target.class,
	style: ({target}) => target.style,
	content: ({target}) => target.content,
	computedStyle: ({me}) => window.getComputedStyle(me._.elem),
	text: ({me}) => modelGetAttr({me, property: "textContent"}),
	parent: ({me}) => ModelMap.get(me._.elem.parentNode),
	owner: ({me}) => me._.owner,
	[dump]: ({me, target}) => () => {
		if (target[isText])
			return modelGetAttr({me, property: "textContent"});
		let ans = {};
		for (let i = 0; i < me._.elem.attributes.length; i++) {
			let attribute = me._.elem.attributes[i];
			ans[attribute.name] = attribute.value;
		}
		Object.assign(ans, target, {
			on: Object.assign({}, target.on),
			style: me._.elem.style,
			content: target.content == null ? undefined :
				target.content instanceof Array ?
					target.content.map((item) => item[dump]()) :
					target.content[dump](),
		});
		return ans;
	},
};

function modelSetAttr({property, value, me}) {
	setAttr(me._.elem, property, value);
	return true;
}
const modelSetCallbacks = {
	[isProxy]: () => false,
	[rawContent]: ({target, value}) => target.content = value,
	tag: () => false,
	ref: () => false,
	text: () => false,
	computedStyle: () => false,
	parent: () => false,
	owner: () => false,
	on: ({target, value, me}) => {
		//remove all event handlers, then add new ones
		removeHandlers(target.on, me._.elem);
		target.on = proxifyHandlers(value, me.$);
		generateHandlers(target.on, me._.elem);
		return true;
	},
	class: ({value, me}) => {
		//remove classes, and add new ones
		me._.elem.removeAttribute("class");
		generateClasses(value, me._.elem);
		return true;
	},
	style: ({value, me}) => {
		//remove styles, and add new ones
		me._.elem.removeAttribute("style");
		generateStyle(value, me._.elem);
		return true;
	},
	content: ({target, value, me}) => {
		disconnectObserver(me.$);
		//remove all content, then add new content
		removeContent(target.content);
		target.content = proxifyContent(value, me.$);
		let contents = arrayWrap(target.content);
		for (let content of contents)
			setRef(me._.owner, content);
		generateContent(target.content, me._.elem);
		connectObserver(me.$);
		return true;
	},
};

function modelDelAttr({property, me}) {
	//remove an attribute
	delAttr(me._.elem, property);
	return true;
}
const modelDelCallbacks = {
	[isProxy]: () => false,
	[rawContent]: ({target}) => delete target.content,
	tag: () => false,
	ref: () => false,
	text: () => false,
	computedStyle: () => false,
	parent: () => false,
	owner: () => false,
	on: ({target, me}) => {
		//remove all event handlers
		removeHandlers(target.on, me._.elem);
		target.on = proxifyHandlers({}, me.$);
		return true;
	},
	class: ({me}) => {
		//remove all classes
		me._.elem.removeAttribute("class");
		return true;
	},
	style: ({me}) => {
		//remove all styles
		me._.elem.removeAttribute("style");
		return true;
	},
	content: ({target}) => {
		disconnectObserver(me.$);
		//remove all content
		removeContent(target.content);
		let ans = delete target.content;
		connectObserver(me.$);
		return ans;
	},
};

//the model proxy handlers
function modelHasHandler(target, property) {
	let me = self(this._);
	return property in modelHasProps || (property in me._.elem && !(me._.elem[property] instanceof Function));
}
function modelGetHandler(target, property) {
	//if the value is not a special property, return it from the dom
	let me = self(this._);
	return (modelGetCallbacks[property] || modelGetAttr)({target, property, me});
}
function modelSetHandler(target, property, value) {
	let me = self(this._);
	return (modelSetCallbacks[property] || modelSetAttr)({target, property, value, me});
}
function modelDelHandler(target, property) {
	let me = self(this._);
	return (modelDelCallbacks[property] || modelDelAttr)({target, property, me});
}

//functions related to manipulating models
function removeHandlers(handlers, elem) {
	for (let handler in handlers)
		elem.removeEventListener(handler, handlers[handler]);
}

function removeContent(content) {
	content = arrayWrap(content);
	for (let item of content) {
		removeRef(item);
		self(item)._.elem.remove();
	}
}

function removeRef(model) {
	let me = self(model);
	//remove the ref
	if (me._.refname)
		delete me._.owner[me._.refname];
	//stop recursing when we hit a class
	if (model instanceof Element)
		return;
	//recurse into content
	let contents = arrayWrap(model.content);
	for (content of contents)
		removeRef(content);
}

function generateModelAttr({elem, property, model}) {
	setAttr(elem, property, model[property]);
	delete model[property];
}
const generateModelCallbacks = {
	tag: () => {},
	on: ({elem, model}) => generateHandlers(model.on, elem),
	class: ({elem, model}) => {
		generateClasses(model.class, elem);
		model.class = proxifyClasses(elem);
	},
	style: ({elem, model}) => {
		generateStyle(model.style, elem);
		model.style = proxifyStyle(elem);
	},
	content: ({elem, model}) => generateContent(model.content, elem),
};
function generateModel(model) {
	//if text node, create text node
	if (model.text) {
		let elem = document.createTextNode(model.text);
		delete model.text;
		model[isText] = true;
		return elem;
	}
	//create the node
	let elem = document.createElement(model.tag);
	for (let property in model)
		(generateModelCallbacks[property] || generateModelAttr)({elem, property, model});
	return elem;
}

function generateHandlers(handlers, elem) {
	//object containing handlers
	for (let handler in handlers)
		elem.addEventListener(handler, handlers[handler]);
}

function generateClasses(classes, elem) {
	if (typeof classes === "string")
		classes = classes.trim().split(/\s+/).filter((s) => s !== "");
	if (!(classes instanceof Array))
		classes = [];
	for (let item of classes)
		elem.classList.add(item);
}

function generateStyle(style, elem) {
	if (typeof style === "string") {
		elem.style = style;
	} else if (typeof style === "object") {
		for (let prop in style)
			elem.style[prop] = style[prop];
	}
}

function generateContent(content, elem) {
	//array containing html content
	content = arrayWrap(content);
	for (let item of content)
		elem.appendChild(self(item)._.elem);
}

function proxifyHandlers(on, proxy) {
	return new Proxy(on, {
		set: modelOnSetHandler.bind(proxy),
		deleteProperty: modelOnDelHandler.bind(proxy),
	});
}

function proxifyClasses(elem) {
	//this method actually has to be called after generateStyle
	return new ClassSet(elem);
}

function proxifyStyle(elem) {
	//this method actually has to be called after generateStyle
	return new Proxy(elem.style, {
		get: cssStyleGetHandler,
		deleteProperty: cssStyleDelHandler,
	});
}

function proxifyContent(content, proxy) {
	if (content == null)
		return null;
	if (content[isProxy])
		return content;
	if (content instanceof Array) {
		for (let i in content)
			content[i] = proxifyModel(content[i]);
		//proxify array of content
		content = new Proxy(content, {
			get: contentArrayGetHandler.bind(proxy),
			set: contentArraySetHandler.bind(proxy),
			deleteProperty: contentArrayDelHandler.bind(proxy),
		});
	} else {
		content = proxifyModel(content);
	}
	return content;
}

//this method creates a proxy and an element for a given model
function proxifyModel(model) {
	//short circuit things that don't need to be proxified
	if (model instanceof Element || model[isProxy])
		return model;
	//special case for tag instanceof Element
	if (model.tag instanceof Element) {
		self(model.tag)._.refname = model.ref;
		return model.tag;
	}
	//check for text nodes
	if (typeof model === "string" || typeof model === "number" || typeof model === "boolean")
		return proxifyModel({text: model.toString()});
	//create proxified model
	//since we can't bind to proxifiedModel before we create it, we must hack
	//it in afterward by binding to an object, then adding proxifiedModel as a
	//property on that object
	let modelHack = {};
	let proxifiedModel = new Proxy(model, {
		has: modelHasHandler.bind(modelHack),
		get: modelGetHandler.bind(modelHack),
		set: modelSetHandler.bind(modelHack),
		deleteProperty: modelDelHandler.bind(modelHack),
	});
	modelHack._ = proxifiedModel;
	//init self for the proxy
	self.init(proxifiedModel);
	//if this is a text node, we have no props of any sort
	if (!model.text) {
		//proxify "on" property
		model.on = proxifyHandlers(model.on || {}, proxifiedModel);
		//proxify classes
		model.class = model.class || undefined;
		//style isn't proxified until after generated
		model.style = model.style || undefined;
		//proxify content models
		model.content = proxifyContent(model.content, proxifiedModel);
		//set and remove ref
		self(proxifiedModel)._.refname = model.ref;
		delete model.ref;
		//create mutation observer
		self(proxifiedModel)._.observer = new MutationObserver(observerCallback.bind(proxifiedModel));
	}
	//generate the DOM node and set initial state
	let elem = generateModel(model);
	self(proxifiedModel)._.elem = elem;
	//set up the reverse map
	ModelMap.set(elem, proxifiedModel);
	//set mutation observer
	connectObserver(proxifiedModel);
	
	return proxifiedModel;
}

//this method creates a proxy and a model for a given element
function proxifyElem(elem) {
	//if we are (somehow) already proxified, return the proxy
	if (ModelMap.has(elem))
		return ModelMap.get(elem);
	//if we arent a text or element type, we can't proxify it
	if (elem.nodeType !== Node.ELEMENT_NODE && elem.nodeType !== Node.TEXT_NODE)
		return null;
	//create a new model
	let model = {};
	//create model hack (see proxifyModel for explanation)
	let modelHack = {};
	let proxifiedModel = new Proxy(model, {
		has: modelHasHandler.bind(modelHack),
		get: modelGetHandler.bind(modelHack),
		set: modelSetHandler.bind(modelHack),
		deleteProperty: modelDelHandler.bind(modelHack),
	});
	modelHack._ = proxifiedModel;
	//init self for the proxy
	self.init(proxifiedModel);
	//if this is a text node, create a text model
	if (elem.nodeType === Node.TEXT_NODE) {
		//add the text property
		model[isText] = true;
	} else if (elem.nodeType === Node.ELEMENT_NODE) {
		//add the tag name
		model.tag = elem.tagName.toLowerCase();
		//add the on property
		model.on = proxifyHandlers(model.on || {}, proxifiedModel);
		//create the class proxy
		model.class = proxifyClasses(elem);
		//create the style proxy
		model.style = proxifyStyle(elem);
		//recurse through the child elements
		if (elem.hasChildNodes()) {
			if (elem.childNodes.length === 1) {
				//create the proxy for the content
				model.content = proxifyElem(elem.childNodes[0]);
			} else {
				//create an array of proxy content
				let content = [];
				for (let child of elem.childNodes)
					content.push(proxifyElem(child));
				//proxify array of content
				model.content = new Proxy(content, {
					set: contentArraySetHandler.bind(proxifiedModel),
					deleteProperty: contentArrayDelHandler.bind(proxifiedModel),
				});
			}
		}
		//create the mutation observer
		self(proxifiedModel)._.observer = new MutationObserver(observerCallback.bind(proxifiedModel));
	}
	//attatch the elem to the model
	self(proxifiedModel)._.elem = elem;
	//set up the reverse map
	ModelMap.set(elem, proxifiedModel);
	//set mutation observer
	connectObserver(proxifiedModel);
	
	return proxifiedModel;
}

function setRef(owner, model) {
	let me = self(model);
	//set the owner
	me._.owner = owner;
	//set the ref property
	if (me._.refname) {
		if (me._.refname in owner)
			throw {message: `'${me._.refname}' already present in Element`, obj: owner};
		Object.defineProperty(owner, me._.refname, {
			configurable: true,
			get: () => model,
		});
	}
	//stop recursing when we hit a class
	if (model instanceof Element)
		return;
	//recurse into content
	let contents = arrayWrap(model.content);
	for (let content of contents)
		setRef(owner, content);
}

//mutation observer functions
const observerOptions = {childList: true};
function observerCallback(mutations) {
	let me = self(this);
	for (let mutation of mutations) {
		//handle added or removed nodes
		if (mutation.addedNodes.length !== 0) {
			let nodes = [...mutation.addedNodes].map((elem) => proxifyElem(elem));
			if (me.$.content == null) {
				me.$[rawContent] = proxifyContent(nodes.length === 1 ? nodes[0] : nodes, me.$);
			} else {
				if (!(me.$.content instanceof Array))
					me.$[rawContent] = proxifyContent([me.$.content], me.$);
				let startIndex = 0;
				if (mutation.previousSibling != null) {
					let sibling = ModelMap.get(mutation.previousSibling);
					if (sibling === self(sibling)._.owner.model)
						sibling = self(sibling)._.owner;
					startIndex = me.$.content.indexOf(sibling) + 1;
				}
				me.$.content[rawContent].splice(startIndex, 0, ...nodes);
			}
			for (let node of nodes)
				setRef(me._.owner, node);
		} else /* mutation.removedNodes */ {
			if (me.$.content == null)
				return;
			if (!(me.$.content instanceof Array))
				me.$[rawContent] = proxifyContent([me.$.content], me.$);
			for (let node of [...mutation.removedNodes]) {
				if (!ModelMap.has(node))
					continue;
				let child = ModelMap.get(node);
				if (child === self(child)._.owner.model)
					child = self(child)._.owner;
				me.$.content[rawContent].splice(me.$.content.indexOf(ModelMap.get(node)), 1);
			}
			if (me.$.content.length === 1)
				me.$[rawContent] = me.$.content[0];
			else if (me.$.content.length === 0)
				delete me.$[rawContent];
		}
	}
}
function connectObserver(proxy) {
	let me = self(proxy);
	if (me._.observer)
		me._.observer.observe(me._.elem, observerOptions);
}
function disconnectObserver(proxy) {
	let me = self(proxy);
	if (me._.observer)
		me._.observer.disconnect();
}

class ClassSet {
	constructor(elem) {
		this.has = this.has.bind(elem);
		this.add = this.add.bind(elem);
		this.delete = this.delete.bind(elem);
		this.clear = this.clear.bind(elem);
		this.toString = this.toString.bind(elem);
		this[Symbol.iterator] = this[Symbol.iterator].bind(elem);
	}
	has(value) {
		return this.classList.contains(value);
	}
	add(value) {
		this.classList.add(value);
	}
	delete(value) {
		this.classList.remove(value);
	}
	clear() {
		this.removeAttribute("class");
	}
	toString() {
		return this.classList.toString();
	}
	[Symbol.iterator]() {
		return this.classList[Symbol.iterator]();
	}
}

class Element {
	constructor(model) {
		self.init(this);
		let me = self(this);
		me._.model = proxifyModel(model);
		setRef(this, me._.model);
		me._.elem = self(me._.model)._.elem;
	}
	get model() {
		let me = self(this);
		return me._.model;
	}
	remove() {
		let me = self(this);
		me._.elem.remove();
	}
	[dump]() {
		let ans = {className: this.constructor.name, classConstructor: this.constructor};
		for (let prop of Object.getOwnPropertyNames(this)) {
			let value = this[prop];
			ans[prop] = value[isProxy] || value instanceof Element ? value[dump]() : value;
		}
		ans.model = this.model[dump]();
		return ans;
	}
}

//add Event.targetModel getter that returns the target Jenny Model
Object.defineProperty(Event.prototype, "targetModel", {
	get: function() {return ModelMap.get(this.target);},
	configurable: true,
	enumerable: true,
});

//convenience function for viewing Jenny data
console.dump = function() { //eslint-disable-line no-console
	const args = [...arguments].map((item) => item[dump] ? item[dump]() : item);
	console.log.apply(console, args); //eslint-disable-line no-console
};

//the root element
let Root;

const Jenny = {
	Element,
	get Root() {
		return Root;
	},
	set Root(elem) {
		Root = proxifyElem(elem);
		setRef(Jenny, Root);
	},
	modelToNode(model) {
		if (!model[isProxy])
			model = Jenny.createModel(model);
		return self(model)._.elem;
	},
	nodeToModel(node) {
		if (!ModelMap.has(node))
			return proxifyElem(node);
		return ModelMap.get(node);
	},
	createModel(model) {
		model = proxifyModel(model);
		setRef(null, model);
		return model;
	},
};

Object.freeze(Jenny);

module.exports = Jenny;

