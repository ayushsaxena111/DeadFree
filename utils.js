// Utilities: logging, table rendering, downloads, timing

export class Logger {
	constructor(containerId, name) {
		this.container = document.getElementById(containerId);
		this.name = name;
		this.lines = [];
		this.startedAt = null;
		this.config = null;
		this.outcome = null;
	}

	log(message) {
		const ts = new Date().toLocaleTimeString();
		const line = `[${ts}] ${message}`;
		this.lines.push(line);
		const div = document.createElement('div');
		div.className = 'log-line';
		div.textContent = line;
		this.container.appendChild(div);
		this.container.scrollTop = this.container.scrollHeight;
	}

	// Enhanced logging for state changes
	logStateChange(processId, newState, details = '') {
		const stateMessages = {
			'waiting': 'is WAITING',
			'blocked': 'is BLOCKED', 
			'starved': 'is STARVED',
			'running': 'is RUNNING',
			'finished': 'is FINISHED'
		};
		const message = `Process ${processId} ${stateMessages[newState] || `changed to ${newState.toUpperCase()}`}${details ? ` (${details})` : ''}`;
		this.log(message);
	}

	clear() {
		this.lines = [];
		this.container.innerHTML = '';
		this.startedAt = null;
		this.config = null;
		this.outcome = null;
	}

	startSession(configObj) {
		this.startedAt = new Date();
		this.config = configObj || {};
	}

	setOutcome(text) { this.outcome = text; }

	exportText(filename) {
		const header = [
			'=== DeadFree Simulation Log ===',
			`Module: ${this.name}`,
			`Timestamp: ${this.startedAt ? this.startedAt.toLocaleString() : new Date().toLocaleString()}`,
			'',
			'Configuration:',
			...(this.config ? Object.entries(this.config).map(([k,v]) => `${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`) : []),
			'',
			'Simulation Steps:'
		].join('\n');
		const footer = ['','Outcome:', this.outcome || ''].join('\n');
		const blob = new Blob([header + '\n' + this.lines.join('\n') + '\n' + footer], { type: 'text/plain' });
		downloadBlob(blob, filename);
	}

	exportJSON(filename) {
		const blob = new Blob([JSON.stringify({ module: this.name, logs: this.lines }, null, 2)], { type: 'application/json' });
		downloadBlob(blob, filename);
	}
}

export function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	URL.revokeObjectURL(url);
	document.body.removeChild(a);
}

export function parseVector(text, m) {
	const arr = text.trim().split(/[\s,]+/).map(Number).filter(n => !Number.isNaN(n));
	if (m != null && arr.length !== m) throw new Error(`Expected ${m} values, got ${arr.length}`);
	return arr;
}

export function parseMatrix(text, rows, cols) {
	const lines = text.trim().split(/\n+/);
	if (rows != null && lines.length !== rows) throw new Error(`Expected ${rows} rows, got ${lines.length}`);
	return lines.map((line, r) => {
		const vals = line.trim().split(/[\s,]+/).map(Number).filter(n => !Number.isNaN(n));
		if (cols != null && vals.length !== cols) throw new Error(`Row ${r} expected ${cols} cols, got ${vals.length}`);
		return vals;
	});
}

export function renderTable(containerId, headers, rows, highlightRowIdx = null, statusData = null) {
	const container = document.getElementById(containerId);
	const table = document.createElement('table');
	if (headers && headers.length) {
		const thead = document.createElement('thead');
		const tr = document.createElement('tr');
		headers.forEach(h => {
			const th = document.createElement('th'); th.textContent = h; tr.appendChild(th);
		});
		thead.appendChild(tr); table.appendChild(thead);
	}
	const tbody = document.createElement('tbody');
	rows.forEach((row, idx) => {
		const tr = document.createElement('tr');
		if (highlightRowIdx === idx) tr.classList.add('row-highlight');
		row.forEach((cell, cellIdx) => {
			const td = document.createElement('td');
			td.textContent = cell;
			// Add status styling if statusData is provided
			if (statusData && statusData[idx]) {
				const status = statusData[idx];
				if (status.waiting && cellIdx === 0) td.classList.add('status-waiting');
				if (status.blocked && cellIdx === 0) td.classList.add('status-blocked');
				if (status.starved && cellIdx === 0) td.classList.add('status-starved');
			}
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});
	table.appendChild(tbody);
	container.innerHTML = '';
	container.appendChild(table);
}

// Speed control: higher slider value => faster (shorter delay)
export function sleepForSpeed(rangeInput) {
	const raw = Number(rangeInput.value || 300);
	// Map 0..1000 to delay 600..0 ms (cap at min 0)
	const delay = Math.max(0, 600 - (raw * 0.6));
	return new Promise(resolve => setTimeout(resolve, delay));
}

export function createActorBadge(id, label) {
	const el = document.createElement('div');
	el.className = 'actor state-grey';
	el.id = id;
	el.textContent = label;
	const bar = document.createElement('div');
	bar.className = 'priority';
	bar.style.width = '0%';
	el.appendChild(bar);
	return el;
}

export function setActorState(el, state) {
	el.classList.remove('state-green', 'state-yellow', 'state-red', 'state-purple', 'state-grey', 'state-orange', 'state-blue', 'state-black');
	el.classList.add(`state-${state}`);
}

export function setPriorityBar(el, percent) {
	const bar = el.querySelector('.priority');
	if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

// Detection utilities for starvation, waiting, and blocking
export class DetectionManager {
	constructor(logger, config = {}) {
		this.logger = logger;
		this.config = {
			starvationThreshold: config.starvationThreshold || 20,
			enableStarvationDetection: config.enableStarvationDetection !== false,
			enableWaitingDetection: config.enableWaitingDetection !== false,
			enableBlockingDetection: config.enableBlockingDetection !== false,
			...config
		};
		this.processStates = new Map(); // processId -> { waitingSteps, state, lastUpdate }
	}

	updateProcessState(processId, newState, details = '') {
		const now = Date.now();
		const current = this.processStates.get(processId) || { waitingSteps: 0, state: 'unknown', lastUpdate: now };
		
		// Update waiting steps
		if (newState === 'waiting' || newState === 'blocked') {
			current.waitingSteps++;
		} else if (newState === 'running' || newState === 'finished') {
			current.waitingSteps = 0;
		}

		// Check for starvation
		if (this.config.enableStarvationDetection && current.waitingSteps >= this.config.starvationThreshold) {
			if (current.state !== 'starved') {
				this.logger.logStateChange(processId, 'starved', `waiting for ${current.waitingSteps} steps`);
				newState = 'starved';
			}
		}

		// Log state changes
		if (current.state !== newState) {
			if (this.config.enableWaitingDetection && newState === 'waiting') {
				this.logger.logStateChange(processId, 'waiting', details);
			} else if (this.config.enableBlockingDetection && newState === 'blocked') {
				this.logger.logStateChange(processId, 'blocked', details);
			} else if (newState !== 'starved') { // starved already logged above
				this.logger.logStateChange(processId, newState, details);
			}
		}

		current.state = newState;
		current.lastUpdate = now;
		this.processStates.set(processId, current);
		
		return newState;
	}

	getProcessState(processId) {
		return this.processStates.get(processId) || { waitingSteps: 0, state: 'unknown', lastUpdate: Date.now() };
	}

	getStatusCounts() {
		const counts = { waiting: 0, blocked: 0, starved: 0, running: 0, finished: 0 };
		for (const [_, state] of this.processStates) {
			counts[state.state] = (counts[state.state] || 0) + 1;
		}
		return counts;
	}

	reset() {
		this.processStates.clear();
	}
}


