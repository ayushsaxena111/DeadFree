import { Logger, sleepForSpeed, DetectionManager } from './utils.js';

(() => {
	const logger = new Logger('dp-logs', 'DiningPhilosophers');
	const el = id => document.getElementById(id);

	let N = 5, threshold = 25;
	let running = false, timer = null;
	let state = [];
	let forks = [];
	let forkOwner = [];
	let detectionManager = null;
	let manualMode = false;
	let isDeadlocked = false;

    function reset() {
		N = Number(el('dp-count').value);
		threshold = Number(el('dp-starvation-threshold') ? el('dp-starvation-threshold').value : el('dp-threshold').value);
		state = Array.from({ length: N }, () => ({ status: 'thinking', wait: 0, priority: 0 }));
		forks = Array(N).fill(false); // false: available, true: in-use
		forkOwner = Array(N).fill(-1); // -1 none, otherwise philosopher index
		manualMode = false;
		isDeadlocked = false;
		
		// Initialize detection manager with configuration
        const config = {
            starvationThreshold: threshold,
            enableStarvationDetection: el('dp-enable-starvation') ? el('dp-enable-starvation').checked : true,
            enableWaitingDetection: el('dp-enable-waiting') ? el('dp-enable-waiting').checked : true,
            enableBlockingDetection: el('dp-enable-blocking') ? el('dp-enable-blocking').checked : true
        };
        detectionManager = new DetectionManager(logger, config);
		
        logger.clear();
        logger.startSession({ Philosophers: N, StarvationThresholdTicks: threshold, DetectionConfig: config });
		draw();
		// build manual controls
        const ctrls = el('dp-controls'); ctrls.innerHTML = '';
        for (let i = 0; i < N; i++) {
            const eat = document.createElement('button'); eat.type = 'button'; eat.textContent = `Eat ${i+1}`;
            const think = document.createElement('button'); think.type = 'button'; think.textContent = `Think ${i+1}`;
			eat.addEventListener('click', () => userEat(i));
			think.addEventListener('click', () => userThink(i));
            ctrls.appendChild(eat); ctrls.appendChild(think);
        }
	}

	function detectDeadlock() {
		// Deadlock if: no one eating, no thinking, all forks held, and each philosopher holds exactly left fork and waits right
		if (state.some(s => s.status === 'eating')) return false;
		if (state.some(s => s.status === 'thinking')) return false;
		if (forks.some(f => !f)) return false;
		for (let i = 0; i < N; i++) {
			const left = i, right = (i + 1) % N;
			if (forkOwner[left] !== i) return false; // not holding left
			if (forkOwner[right] === -1) return false; // right must be held by neighbor
		}
		return true;
	}

	function userEat(i) {
		manualMode = true;
		isDeadlocked = false;
		// If already eating, ignore
		if (state[i].status === 'eating') return;
		state[i].status = 'hungry';
		const left = i, right = (i + 1) % N;
		// Try to take left fork if not held
		if (!forks[left]) { forks[left] = true; forkOwner[left] = i; }
		// Try to take right too if available now
		if (!forks[right]) { forks[right] = true; forkOwner[right] = i; }
		if (forkOwner[left] === i && forkOwner[right] === i) {
			state[i].status = 'eating';
			state[i].wait = 0; state[i].priority = 0;
			if (detectionManager) detectionManager.updateProcessState(`P${i + 1}`, 'running', 'manually started eating');
			logger.log(`Philosopher ${i + 1} is eating with Fork ${i + 1} and Fork ${(i + 1) % N + 1}.`);
		} else {
			// Holding one or none -> blocked/waiting for fork
			if (detectionManager) detectionManager.updateProcessState(`P${i + 1}`, 'blocked', 'fork not available');
			logger.log(`Philosopher ${i + 1} is hungry and waiting for a fork.`);
		}
		// Deadlock check
		if (detectDeadlock()) {
			isDeadlocked = true;
			logger.log('Deadlock detected: circular wait. Each philosopher holds left fork and waits for right.');
			logger.setOutcome('Deadlock occurred (circular wait).');
			// Mark all as blocked for visualization
			for (let k = 0; k < N; k++) detectionManager.updateProcessState(`P${k + 1}`, 'blocked', 'deadlocked');
		}
		draw();
	}

	function userThink(i) {
		manualMode = true;
		// Release forks if any
		release(i);
		state[i].status = 'thinking';
		state[i].wait = 0; state[i].priority = 0;
		if (detectionManager) detectionManager.updateProcessState(`P${i + 1}`, 'finished', 'manually set to thinking');
		logger.log(`Philosopher ${i + 1} is thinking.`);
		// Clear deadlock if any philosopher releases
		isDeadlocked = false;
		draw();
	}

	function waiterPick(i) {
		// Waiter solution: allow at most N-1 philosophers to try to eat
		const left = i, right = (i + 1) % N;
		if (forks[left] || forks[right]) return false;
		const eatingCount = state.filter(s => s.status === 'eating').length;
		if (eatingCount >= N - 1) return false;
		forks[left] = forks[right] = true; forkOwner[left] = i; forkOwner[right] = i; return true;
	}

	function release(i) {
		const left = i, right = (i + 1) % N;
		if (forkOwner[left] === i) { forks[left] = false; forkOwner[left] = -1; }
		if (forkOwner[right] === i) { forks[right] = false; forkOwner[right] = -1; }
	}

	function tick() {
		// Update detection manager states and aging
		state.forEach((s, i) => {
			const philosopherId = `P${i + 1}`;
			
			if (s.status !== 'eating') {
				s.wait += 1;
				
				// Update detection manager state
				let detectionState = 'waiting';
				let details = `waiting for ${s.wait} ticks`;
				
				if (s.status === 'hungry') {
					const left = i, right = (i + 1) % N;
					if (forks[left] || forks[right]) {
						detectionState = 'blocked';
						details = `blocked by forks (left: ${forks[left] ? 'taken' : 'free'}, right: ${forks[right] ? 'taken' : 'free'})`;
					}
				}
				
				const newState = detectionManager.updateProcessState(philosopherId, detectionState, details);
				
				// Update priority based on detection result
				if (newState === 'starved' || s.wait >= threshold) {
					s.priority = Math.min(100, s.priority + 10);
				}
			} else {
				// Philosopher is eating
				detectionManager.updateProcessState(philosopherId, 'running', 'eating');
			}
		});

		// If manual mode is active, do not auto-pick or auto-change statuses
		if (!manualMode) {
			// Attempt to schedule by highest priority first among hungry/thinking
			const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => state[b].priority - state[a].priority);
			for (const i of order) {
				const s = state[i];
				if (s.status === 'eating') continue;
				// Become hungry first
				if (s.status === 'thinking') {
					s.status = 'hungry';
					detectionManager.updateProcessState(`P${i + 1}`, 'waiting', 'became hungry');
					logger.log(`Philosopher ${i + 1} is hungry.`);
				}
				// Try to pick forks via waiter
				if (waiterPick(i)) {
					s.status = 'eating';
					s.wait = 0; s.priority = 0;
					detectionManager.updateProcessState(`P${i + 1}`, 'running', 'eating');
					logger.log(`Philosopher ${i + 1} is eating with Fork ${i + 1} and Fork ${(i + 1) % N + 1}.`);
				}
			}
		}
		
		// Some eaters will release and think next cycle to create dynamics (only in auto mode)
		if (!manualMode) {
			state.forEach((s, i) => {
				if (s.status === 'eating' && Math.random() < 0.5) {
					s.status = 'thinking';
					release(i);
					detectionManager.updateProcessState(`P${i + 1}`, 'finished', 'finished eating, now thinking');
					logger.log(`Philosopher ${i + 1} is thinking.`);
				}
			});
		}

		// If manual mode, check for deadlock each tick as well
		if (manualMode && detectDeadlock()) {
			if (!isDeadlocked) {
				isDeadlocked = true;
				logger.log('Deadlock detected: circular wait. Each philosopher holds left fork and waits for right.');
				logger.setOutcome('Deadlock occurred (circular wait).');
				for (let k = 0; k < N; k++) detectionManager.updateProcessState(`P${k + 1}`, 'blocked', 'deadlocked');
			}
		}
	}

	function draw() {
		const canvas = el('dp-canvas');
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const cx = canvas.width / 2, cy = canvas.height / 2, r = Math.min(cx, cy) - 40;
		// draw table circle
		ctx.strokeStyle = isDeadlocked ? '#7f1d1d' : '#334155';
		ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r + 20, 0, Math.PI * 2); ctx.stroke();
		for (let i = 0; i < N; i++) {
			const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
			const x = cx + r * Math.cos(angle);
			const y = cy + r * Math.sin(angle);
			const s = state[i];
			
			// Color by detection manager state if available
			let color = '#374151'; // thinking grey (default)
			if (detectionManager) {
				const detectionState = detectionManager.getProcessState(`P${i + 1}`);
				switch (detectionState.state) {
					case 'waiting': color = '#c2410c'; break; // orange
					case 'blocked': color = '#1e40af'; break; // blue
					case 'starved': color = '#1f2937'; break; // black
					case 'running': color = '#065f46'; break; // green (eating)
					case 'finished': color = '#374151'; break; // grey (thinking)
					default:
						// Fallback to legacy colors
						if (s.status === 'hungry') color = '#78350f'; // yellow
						if (s.status === 'eating') color = '#065f46'; // green
						if (s.wait >= threshold) color = '#581c87'; // purple
				}
			} else {
				// Legacy color logic
				if (s.status === 'hungry') color = '#78350f';
				if (s.status === 'eating') color = '#065f46';
				if (s.wait >= threshold) color = '#581c87';
			}
			
			ctx.fillStyle = color;
			ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x, y + 4);
			
			// forks as small rectangles between philosophers; highlight if in use
			const left = i, right = (i + 1) % N;
			const fx = cx + (r - 28) * Math.cos(angle);
			const fy = cy + (r - 28) * Math.sin(angle);
			ctx.fillStyle = forks[left] ? (isDeadlocked ? '#ef4444' : '#22c55e') : '#334155';
			ctx.fillRect(fx - 6, fy - 6, 12, 12);
		}
	}

	function start() {
		if (running) return; running = true;
		const speed = el('dp-speed');
		const loop = async () => {
			if (!running) return;
			tick(); draw();
			await sleepForSpeed(speed);
			if (running) timer = requestAnimationFrame(loop);
		};
		timer = requestAnimationFrame(loop);
	}
	function stop() { running = false; if (timer) cancelAnimationFrame(timer); }

	// Events
	el('dp-start').addEventListener('click', () => start());
	el('dp-pause').addEventListener('click', () => stop());
	el('dp-step').addEventListener('click', () => { stop(); tick(); draw(); });
	el('dp-reset').addEventListener('click', () => { stop(); reset(); });
	el('dp-export-log').addEventListener('click', () => logger.exportText('philosophers-log.txt'));
	el('dp-export-json').addEventListener('click', () => logger.exportJSON('philosophers-log.json'));

	reset();
})();



