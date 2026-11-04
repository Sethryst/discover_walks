//#region \0runtime-assets
var e = new URL("worker.js", import.meta.url).href, t = new URL("valhalla-browser.wasm", import.meta.url).href, n = class extends Error {
	code;
	retryable;
	nativeCode;
	constructor(e, t, { retryable: n = !1, nativeCode: r, cause: i } = {}) {
		super(t, { cause: i }), this.name = "RoutingError", this.code = e, this.retryable = n, r !== void 0 && (this.nativeCode = r);
	}
	toJSON() {
		return {
			code: this.code,
			message: this.message,
			retryable: this.retryable,
			nativeCode: this.nativeCode
		};
	}
}, r = () => new n("CANCELLED", "Route cancelled."), i = [
	"auto",
	"bicycle",
	"pedestrian",
	"truck"
], a = {
	bicycle: {
		cycling_speed: [5, 60],
		use_roads: [0, 1]
	},
	pedestrian: { walking_speed: [.5, 25] },
	truck: {
		height: [0, 10],
		width: [0, 10],
		length: [0, 50],
		weight: [0, 100],
		axle_load: [0, 40]
	}
}, o = (e) => !!e && typeof e == "object" && !Array.isArray(e), s = (e) => {
	throw new n("INVALID_REQUEST", e);
};
function c(e) {
	if (!o(e)) return s("A route request is required.");
	let t = e.costing === void 0 ? "auto" : e.costing;
	if (!i.includes(t)) throw new n("UNSUPPORTED_COSTING", "Supported profiles: auto, bicycle, pedestrian, truck.");
	let r = e.locations ?? [e.origin, e.destination];
	if (!Array.isArray(r) || r.length !== 2) return s("Exactly two locations are required.");
	for (let e of r) if (!o(e) || typeof e.lat != "number" || !Number.isFinite(e.lat) || Math.abs(e.lat) > 90 || typeof e.lon != "number" || !Number.isFinite(e.lon) || Math.abs(e.lon) > 180) return s("Coordinates must be finite latitude/longitude values.");
	let c = {
		locations: r.map(({ lat: e, lon: t }) => ({
			lat: e,
			lon: t,
			radius: 30,
			minimum_reachability: 0
		})),
		costing: t,
		units: "kilometers",
		language: "en-US"
	};
	if (e.costing_options !== void 0) {
		let n = e.costing_options;
		if (t === "auto" || !o(n) || Object.keys(n).length !== 1 || !Object.hasOwn(n, t)) return s("costing_options must contain only the selected profile. Driving options are not exposed.");
		let r = n[t];
		if (!o(r)) return s("Profile options must be an object.");
		let i = {};
		for (let [e, n] of Object.entries(r)) {
			let r = Object.hasOwn(a[t], e) ? a[t][e] : void 0;
			if (r) {
				if (typeof n != "number" || !Number.isFinite(n) || n < r[0] || n > r[1]) return s(`${t}.${e} must be a finite number from ${r[0]} to ${r[1]}.`);
			} else if (t === "bicycle" && e === "bicycle_type") {
				if (![
					"road",
					"cross",
					"hybrid",
					"mountain"
				].includes(n)) return s("Invalid bicycle_type.");
			} else if (t === "truck" && e === "hazmat") {
				if (typeof n != "boolean") return s("truck.hazmat must be a boolean.");
			} else return s(`Unsupported option: ${t}.${e}.`);
			i[e] = n;
		}
		c.costing_options = { [t]: i };
	}
	return c;
}
var l = Object.freeze({
	initialMiB: 128,
	maximumMiB: 512
});
Object.freeze({
	initialMiB: 256,
	maximumMiB: 512
}), Object.freeze({
	initialMiB: 64,
	maximumMiB: 96
});
function u(e, t = l) {
	let r = () => {
		throw new n("INVALID_REQUEST", "wasmMemory requires integer MiB values: 64 <= initialMiB <= maximumMiB <= 1024.");
	};
	if (e !== void 0 && (!e || typeof e != "object" || Array.isArray(e))) return r();
	let i = e ?? {};
	if (Object.keys(i).some((e) => !["initialMiB", "maximumMiB"].includes(e))) return r();
	let a = i.initialMiB === void 0 ? t.initialMiB : i.initialMiB, o = i.maximumMiB === void 0 ? t.maximumMiB : i.maximumMiB;
	return typeof a != "number" || typeof o != "number" || !Number.isInteger(a) || !Number.isInteger(o) || a < 64 || a > o || o > 1024 ? r() : {
		initialMiB: a,
		maximumMiB: o
	};
}
//#endregion
//#region src/client.ts
var d = class {
	options;
	startup;
	pending = /* @__PURE__ */ new Map();
	sequence = 0;
	disposed = !1;
	worker;
	ready;
	bootstrapUrl;
	bootTimer;
	constructor(e) {
		this.options = {
			...e,
			manifestUrl: new URL(e.manifestUrl, location.href).href
		};
	}
	createWorker() {
		if (this.options.workerFactory) return this.options.workerFactory();
		let t = new URL(this.options.workerUrl ?? e, location.href), n = t.href;
		return t.origin !== location.origin && (this.bootstrapUrl = URL.createObjectURL(new Blob([`import ${JSON.stringify(n)};`], { type: "text/javascript" })), n = this.bootstrapUrl), new Worker(n, {
			type: "module",
			name: "valhalla-routing"
		});
	}
	releaseBootstrap() {
		this.bootTimer !== void 0 && clearTimeout(this.bootTimer), this.bootTimer = void 0, this.bootstrapUrl && URL.revokeObjectURL(this.bootstrapUrl), this.bootstrapUrl = void 0;
	}
	async initialize() {
		if (this.disposed) throw new n("DISPOSED", "Router is disposed.");
		if (this.ready) return this.ready;
		u(this.options.wasmMemory);
		let e = performance.now(), r, i;
		try {
			i = new URL(this.options.wasmUrl ?? t, location.href).href, r = this.createWorker();
		} catch (e) {
			throw this.releaseBootstrap(), new n("WORKER_FAILED", "Cannot create routing worker. Check asset URLs and CSP.", { cause: e });
		}
		let { manifestUrl: a, transport: o, timeoutMs: s, retries: c, memoryBudgetBytes: l, searchMemory: d, wasmMemory: f } = this.options, p = { options: {
			manifestUrl: a,
			transport: o,
			timeoutMs: s,
			retries: c,
			memoryBudgetBytes: l,
			searchMemory: d,
			wasmMemory: f,
			wasmUrl: i
		} }, m = ++this.sequence, h = 0, g = (e) => e !== this.worker || !this.pending.has(m) || this.options.workerFactory || c === 0 || h >= 1 ? !1 : (h++, this.worker = void 0, e.onmessage = e.onerror = e.onmessageerror = null, e.terminate(), this.releaseBootstrap(), this.bootTimer = setTimeout(() => {
			if (this.pending.has(m) && !this.disposed) try {
				let e = this.createWorker();
				_(e), e.postMessage({
					id: m,
					type: "initialize",
					...p
				});
			} catch (e) {
				this.reset(new n("WORKER_FAILED", "Cannot restart routing worker.", { cause: e }));
			}
		}, 100), !0), _ = (e) => {
			this.worker = e;
			let t = !1;
			e.onmessage = ({ data: r }) => {
				if (e !== this.worker || (t = !0, this.releaseBootstrap(), r.type === "ready")) return;
				let i = this.pending.get(r.id);
				if (i) {
					if (r.type === "progress") {
						r.detail.phase === "loading-runtime" && (this.bootTimer = setTimeout(() => {
							e !== this.worker || g(e) || this.reset(new n("TIMEOUT", "WASM runtime initialization timed out.", { retryable: !0 }));
						}, Math.max(1e4, this.options.timeoutMs ?? 1e4)));
						try {
							this.options.onProgress?.({
								requestId: r.id,
								...r.detail
							});
						} catch {}
						return;
					}
					if (this.pending.delete(r.id), i.cleanup(), r.type === "error") {
						let e = new n(r.error.code, r.error.message, r.error);
						i.reject(e), [
							"RUNTIME",
							"RESOURCE_LIMIT",
							"WORKER_FAILED"
						].includes(e.code) && this.reset(e);
					} else i.resolve(r.result);
				}
			}, e.onerror = (r) => {
				r.preventDefault(), e === this.worker && (t || r.message || !g(e)) && this.reset(new n("WORKER_FAILED", r.message || "Worker failed. Check asset URLs and CSP."));
			}, e.onmessageerror = () => {
				e === this.worker && this.reset(new n("WORKER_FAILED", "Invalid worker message."));
			}, this.options.workerFactory || (this.bootTimer = setTimeout(() => {
				e === this.worker && this.reset(new n("WORKER_FAILED", "Routing worker did not start. Check asset URLs, CORS, and CSP."));
			}, this.options.timeoutMs ?? 1e4));
		};
		_(r);
		let v = this.send("initialize", p, void 0, m).then((t) => {
			let n = {
				...t,
				workerReadyMs: performance.now() - e
			};
			return this.startup = n, n;
		}).catch((e) => {
			throw this.ready === v && this.reset(e), e;
		});
		return this.ready = v, v;
	}
	send(e, t, r, i = ++this.sequence) {
		return new Promise((a, o) => {
			let s = () => this.cancel();
			if (this.pending.set(i, {
				resolve: (e) => a(e),
				reject: o,
				cleanup: () => r?.removeEventListener("abort", s)
			}), r?.addEventListener("abort", s, { once: !0 }), r?.aborted) {
				s();
				return;
			}
			try {
				this.worker.postMessage({
					id: i,
					type: e,
					...t
				});
			} catch (e) {
				this.reset(new n("WORKER_FAILED", "Cannot send request to routing worker.", { cause: e }));
			}
		});
	}
	async route(e, { signal: t } = {}) {
		let n = performance.now(), i = c(e);
		if (t?.aborted) throw r();
		let a = () => this.cancel();
		t?.addEventListener("abort", a, { once: !0 });
		try {
			await this.initialize();
		} finally {
			t?.removeEventListener("abort", a);
		}
		if (t?.aborted) throw r();
		let o = await this.send("route", { request: i }, t);
		return {
			...o,
			diagnostics: {
				...o.diagnostics,
				hostRouteMs: performance.now() - n
			}
		};
	}
	reset(e) {
		this.worker?.terminate(), this.worker = void 0, this.ready = void 0, this.startup = void 0, this.releaseBootstrap();
		for (let t of this.pending.values()) t.cleanup(), t.reject(e);
		this.pending.clear();
	}
	cancel() {
		this.reset(r());
	}
	async diagnostics() {
		return await this.initialize(), this.send("diagnostics", {});
	}
	async dispose() {
		this.disposed = !0, this.reset(new n("DISPOSED", "Router is disposed."));
	}
};
async function f(e) {
	let t = new d(e);
	return await t.initialize(), t;
}
//#endregion
export { d as Router, n as RoutingError, f as createRouter };

//# sourceMappingURL=index.js.map