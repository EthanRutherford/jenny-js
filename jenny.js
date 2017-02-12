const privacyMap = new WeakMap();
let okToConstruct = null;
const indexModulo = (m, n) => m < 0 ? (m % n) + n : m;

class JennyContentArray extends Array {
	constructor(...args) {
		super(...args);
		this._parent = this[0] ? this[0].parentNode : null;
	}
	push(...items) {
		return super.push.call(this, ...this._parent.append(...items));
	}
	pop() {
		return super.pop.call(this).remove();
	}
	unshift(...items) {
		return super.unshift.call(this, ...this._parent.prepend(...items));
	}
	shift() {
		return super.shift.call(this).remove();
	}
	sort(compare) {
		super.sort.call(this, compare);
		this._parent.append(...this);
		return this;
	}
	reverse() {
		super.reverse.call(this);
		this._parent.append(...this);
		return this;
	}
	splice(start, count, ...items) {
		start = indexModulo(start, this.length);
		if (this[start]) {
			this[start].before(...items);
		} else {
			this._parent.append(...items);
		}
		return super.splice.call(this, start, count, ...items).map((item) => item.remove());
	}
	replace(index, ...newItems) {
		let items = this[index].replaceWith(...newItems);
		super.splice.call(this, index, 1, ...items);
	}
}

class JennyElement extends Element {
	get content() {
		return new JennyContentArray(...this.childNodes);
	}
	set content(newContent) {
		while (this.lastChild) this.lastChild.remove();
		this.append(...newContent);
	}
	get computedStyle() {
		return getComputedStyle(this);
	}
	get class() {return this.classList;}
	set class(name) {return this.classList = name;}
	get contentEditable() {return this.getAttribute("contenteditable");}
	set contentEditable(value) {return this.setAttribute("contenteditable", value);}
}

class Controller {
	constructor() {
		if (this.constructor !== okToConstruct) {
			throw new Error("Illegal constructor");
		}

		let descriptors = Object.getOwnPropertyDescriptors(this.__proto__);
		let names = Object.keys(descriptors).filter((name) => {
			return !["constructor", "init"].includes(name) && descriptors[name].value instanceof Function;
		});

		for (let name of names) {
			this[name] = this[name].bind(this);
		}

		this.props = {};
		okToConstruct = null;
	}
	init() {
		return null;
	}
	get model() {
		return privacyMap.get(this);
	}
	remove() {
		this.model.remove();
	}
	validateProps() {
		let propTypes = this.constructor.propTypes || {};
		for (let propName of Object.keys(propTypes)) {
			let prop = this.props[propName];
			let propType = propTypes[propName];
			if (prop == null && propType.required) {
				console.warn(`Missing prop '${propName}: ${propType.type.name}' in ${this.constructor.name}`);
			} else if (prop != null && !(prop.constructor === propType.type || prop instanceof propType.type)) {
				console.warn(`Failed propType '${propName}: ${propType.type.name}' in ${this.constructor.name}`);
			}
		}
	}
}

(function updateInterfaces() {
	function methodReplacer(prototype, oldFunc) {
		return function(...nodes) {
			nodes = nodes.map((node) => prepareNode(node));
			oldFunc.call(this, ...nodes);
			return nodes;
		};
	}

	(function updateChildNodesInterface(prototypes) {
		for (let prototype of prototypes) {
			prototype.before = methodReplacer(prototype, prototype.before);
			prototype.after = methodReplacer(prototype, prototype.after);
			prototype.replaceWith = methodReplacer(prototype, prototype.replaceWith);
			const oldRemove = prototype.remove;
			prototype.remove = function() {
				oldRemove.call(this);
				return this;
			};
		}
	})([Element.prototype, CharacterData.prototype, DocumentType.prototype]);

	(function updateParentNodesInterface(prototypes) {
		for (let prototype of prototypes) {
			prototype.append = methodReplacer(prototype, prototype.append);
			prototype.prepend = methodReplacer(prototype, prototype.prepend);
		}
	})([Element.prototype, Document.prototype, DocumentFragment.prototype]);

	HTMLElement.prototype.__proto__ = JennyElement.prototype;
})();

function jController(tag, children) {
	if (tag.length > 2 || tag.length === 0) {
		throw new Error("bad tag");
	}

	okToConstruct = tag[0];
	let controller = new tag[0]();
	let props = Object.assign({children}, tag[1]);
	if (props.ref) {
		controller._ref = props.ref;
		delete props.ref;
	}

	controller.props = props;
	controller.validateProps();
	let model = controller.init();
	if (model !== null) {
		model.controller = controller;
		privacyMap.set(controller, model);
	}

	return controller;
}

function j(tag, children = []) {
	if (tag instanceof Array) {
		return jController(tag, children);
	}
	if (Object.keys(tag).length !== 1) {
		throw new Error("bad tag");
	}

	let tagName = Object.keys(tag)[0];
	let props = Object.assign({}, tag[tagName]);
	let elem = document.createElement(tagName);
	if (props.ref) {
		elem._ref = props.ref;
		delete props.ref;
	}

	for (let prop of Object.keys(props)) {
		elem[prop] = props[prop];
	}

	children = children.filter((child) => child != null);
	for (let child of children) {
		elem.append(child);
	}

	return elem;
}

function prepareNode(node) {
	return node instanceof Controller ? node.model : node;
}

function attach(node) {
	if (node._ref instanceof Function) {
		node._ref(node);
	}
	if (node.controller) {
		if (node.controller.didMount instanceof Function) {
			window.setTimeout(() => node.controller.didMount());
		}
		if (node.controller._ref instanceof Function) {
			node.controller._ref(node.controller);
		}
	}
	for (let child of node.children) {
		attach(child);
	}
}

function detach(node) {
	if (node._ref instanceof Function) {
		node._ref(null);
	}
	if (node.controller) {
		if (node.controller.didUnmount instanceof Function) {
			window.setTimeout(() => node.controller.didUnmount());
		}
		if (node.controller._ref instanceof Function) {
			node.controller._ref(null);
		}
	}
	for (let child of node.children) {
		detach(child);
	}
}

const observer = new MutationObserver((mutations) => {
	for (let mutation of mutations) {
		for (let node of mutation.addedNodes) {
			if (node instanceof JennyElement) {
				attach(node);
			}
		}
		for (let node of mutation.removedNodes) {
			if (node instanceof JennyElement) {
				detach(node);
			}
		}
	}
});

observer.observe(document.body, {childList: true, subtree: true});

module.exports = {
	Controller,
	j,
	PropTypes: {
		required: (type) => ({required: true, type}),
		optional: (type) => ({required: false, type}),
	},
};
