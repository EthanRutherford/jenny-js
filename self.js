class Self {
	constructor() {
		const wm = new WeakMap();
		function self(obj) {
			return wm.get(obj);
		}
		self.__proto__ = Self.prototype;
		self.init = function(obj) {
			wm.set(obj, Object.freeze({$: obj, _: {}}));
		};
		return self;
	}
}

module.exports = {
	getSelf: () => new Self()
};

