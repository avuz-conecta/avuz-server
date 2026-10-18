// Shifts the process clock to BUILD_DATE so browserslist "baseline widely
// available" resolves the same targets the upstream release build did.
const RealDate = Date
const offsetMs = new RealDate(process.env.BUILD_DATE).getTime() - RealDate.now()
class ShiftedDate extends RealDate {
	constructor(...args) {
		if (args.length === 0) super(RealDate.now() + offsetMs)
		else super(...args)
	}
	static now() { return RealDate.now() + offsetMs }
}
globalThis.Date = ShiftedDate
