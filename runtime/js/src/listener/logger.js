const _tz = process.env.TZ || "Asia/Shanghai";

const _dtfParts = new Intl.DateTimeFormat("sv-SE", {
  timeZone: _tz,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hour12: false,
});

const _dtfOffset = new Intl.DateTimeFormat("en-GB", {
  timeZone: _tz,
  timeZoneName: "longOffset",
});

function _getOffsetStr() {
  for (const { type, value } of _dtfOffset.formatToParts(new Date())) {
    if (type === "timeZoneName") {
      // value is like "GMT+08:00" or "GMT"
      return value.replace("GMT", "") || "+00:00";
    }
  }
  return "+00:00";
}

function nowIso() {
  const parts = _dtfParts.formatToParts(new Date());
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  const offset = _getOffsetStr();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${p.fractionalSecond}${offset}`;
}

function createLogger(verbose) {
  const allowDebug = Boolean(verbose);
  return {
    info(msg) {
      process.stdout.write(`${nowIso()} INFO a2hmarket-listener - ${msg}\n`);
    },
    warn(msg) {
      process.stdout.write(`${nowIso()} WARN a2hmarket-listener - ${msg}\n`);
    },
    error(msg) {
      process.stderr.write(`${nowIso()} ERROR a2hmarket-listener - ${msg}\n`);
    },
    debug(msg) {
      if (!allowDebug) return;
      process.stdout.write(`${nowIso()} DEBUG a2hmarket-listener - ${msg}\n`);
    },
  };
}

module.exports = {
  createLogger,
};
