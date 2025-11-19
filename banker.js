import { Logger, parseVector, parseMatrix, renderTable, sleepForSpeed, DetectionManager, setActorState } from './utils.js';

(() => {
	const logger = new Logger('b-logs', 'Banker');

	let P = 0, R = 0;
	let Max = [], Allocation = [], Need = [], Available = [];
	let Work = [], Finish = [], safeSeq = [];
	let stepIndex = 0; // how many processes finished
	let running = false, timer = null;
	let detectionManager = null;

	const el = id => document.getElementById(id);

	function computeNeed() {
		Need = Max.map((row, i) => row.map((val, j) => Math.max(0, val - Allocation[i][j])));
	}

	function resetTables(highlight = null) {
		// Create status data for table rendering
		const statusData = Array.from({ length: P }, (_, i) => {
			const state = detectionManager ? detectionManager.getProcessState(`P${i}`) : { state: 'unknown' };
			return {
				waiting: state.state === 'waiting',
				blocked: state.state === 'blocked',
				starved: state.state === 'starved'
			};
		});

		renderTable('b-table-available', ['R0..'], [Available]);
		renderTable('b-table-work', ['R0..'], [Work]);
		
		// Enhanced finish table with status columns
		const finishHeaders = ['Process', 'Finished', 'Status', 'Waiting Steps'];
		const finishRows = Array.from({ length: P }, (_, i) => {
			const state = detectionManager ? detectionManager.getProcessState(`P${i}`) : { state: 'unknown', waitingSteps: 0 };
			return [`P${i}`, Finish[i] ? 'T' : 'F', state.state.toUpperCase(), state.waitingSteps];
		});
		renderTable('b-table-finish', finishHeaders, finishRows, highlight, statusData);
		
		renderTable('b-table-max', Array.from({ length: R }, (_, j) => 'R' + j), Max, highlight, statusData);
		renderTable('b-table-allocation', Array.from({ length: R }, (_, j) => 'R' + j), Allocation, highlight, statusData);
		renderTable('b-table-need', Array.from({ length: R }, (_, j) => 'R' + j), Need, highlight, statusData);
		
		// safe sequence
		const seqDiv = el('b-safe-seq');
		seqDiv.innerHTML = '';
		safeSeq.forEach(p => {
			const s = document.createElement('span');
			s.textContent = 'P' + p;
			s.className = 'pill green';
			seqDiv.appendChild(s);
		});
	}

    function parseInputs() {
        P = Number(el('b-proc').value);
        R = Number(el('b-res').value);
        Max = parseMatrix(el('b-max').value, P, R);
        Allocation = parseMatrix(el('b-allocation').value, P, R);
        
        // Initialize detection manager with configuration
        const config = {
            starvationThreshold: Number(el('b-starvation-threshold').value),
            enableStarvationDetection: el('b-enable-starvation').checked,
            enableWaitingDetection: el('b-enable-waiting').checked,
            enableBlockingDetection: el('b-enable-blocking').checked
        };
        detectionManager = new DetectionManager(logger, config);
        
        // Compute Available = total resources - sum(Allocation)
        const total = Array(R).fill(0);
        for (let i = 0; i < P; i++) for (let j = 0; j < R; j++) total[j] = Math.max(total[j], Max[i][j]);
        const allocatedSum = Array(R).fill(0);
        for (let i = 0; i < P; i++) for (let j = 0; j < R; j++) allocatedSum[j] += Allocation[i][j];
        Available = total.map((t, j) => Math.max(0, t - allocatedSum[j]));
        el('b-available').value = Available.join(' ');
        computeNeed();
        Work = [...Available];
		Finish = Array(P).fill(false);
		safeSeq = [];
		stepIndex = 0;
        logger.clear();
        logger.startSession({ Processes: P, Resources: R, Available, Max, Allocation, DetectionConfig: config });
        logger.log('Initialized matrices. Need = Max - Allocation');
        
        // Initialize all processes as waiting initially
        for (let i = 0; i < P; i++) {
            detectionManager.updateProcessState(`P${i}`, 'waiting', 'waiting for resources');
        }
        
		resetTables();
		drawRAG();
	}

	function canExecute(i) {
		for (let j = 0; j < R; j++) if (Need[i][j] > Work[j]) return false;
		return !Finish[i];
	}

	function performStep() {
		// Update all unfinished processes as waiting/blocked
		for (let i = 0; i < P; i++) {
			if (!Finish[i]) {
				const canRun = canExecute(i);
				const newState = canRun ? 'waiting' : 'blocked';
				const details = canRun ? 'can execute when scheduled' : 'insufficient resources available';
				detectionManager.updateProcessState(`P${i}`, newState, details);
			}
		}

		// Try to find a process that can execute
		let chosen = -1;
		for (let i = 0; i < P; i++) {
			if (!Finish[i] && canExecute(i)) { chosen = i; break; }
		}
        if (chosen >= 0) {
            // Process can run
            detectionManager.updateProcessState(`P${chosen}`, 'running', 'executing and releasing resources');
            logger.log(`Step ${safeSeq.length + 1}: Process P${chosen} can finish. Work updated to ${JSON.stringify(Work.map((w,j)=>w+Allocation[chosen][j]))}. Finish[P${chosen}] = true.`);
			for (let j = 0; j < R; j++) Work[j] += Allocation[chosen][j];
			Finish[chosen] = true;
			detectionManager.updateProcessState(`P${chosen}`, 'finished', 'completed execution');
			safeSeq.push(chosen);
			resetTables(chosen);
			drawRAG();
			if (safeSeq.length === P) {
                logger.log('System is in a Safe State.');
                logger.setOutcome(`System is in a Safe State. Safe Sequence: <${safeSeq.map(p=>'P'+p).join(', ')}>`);
				stopRunning();
			}
			return;
		}
		// No process can execute => either done or deadlock
		if (Finish.every(f => f)) {
			logger.log('System is SAFE.');
			stopRunning();
			return;
		}
		// Deadlock detected - mark all unfinished processes as blocked
        const deadlocked = [];
		for (let i = 0; i < P; i++) {
			if (!Finish[i]) {
				deadlocked.push('P' + i);
				detectionManager.updateProcessState(`P${i}`, 'blocked', 'circular wait detected');
			}
		}
        logger.log(`System is UNSAFE → deadlock detected in ${deadlocked.join(', ')}.`);
        logger.log('Coffman condition violated: Circular wait (cycle in wait-for graph).');
        logger.setOutcome(`Deadlock detected involving: ${deadlocked.join(', ')}.`);
		resetTables(null);
		drawRAG(true);
		stopRunning();
	}

	function startRunning() {
		if (running) return;
		running = true;
		const speed = el('b-speed');
		const tick = async () => {
			if (!running) return;
			performStep();
			await sleepForSpeed(speed);
			if (running) timer = requestAnimationFrame(tick);
		};
		timer = requestAnimationFrame(tick);
	}

	function stopRunning() {
		running = false;
		if (timer) cancelAnimationFrame(timer);
	}

	function resetAll() {
		stopRunning();
		parseInputs();
	}

	// Recovery strategies
	function recoverVictimTermination() {
		// Choose unfinished process with least total Allocation
		let victim = -1, minAlloc = Number.POSITIVE_INFINITY;
		for (let i = 0; i < P; i++) if (!Finish[i]) {
			const total = Allocation[i].reduce((a, b) => a + b, 0);
			if (total < minAlloc) { minAlloc = total; victim = i; }
		}
		if (victim < 0) { logger.log('No victim found.'); return; }
		for (let j = 0; j < R; j++) Work[j] += Allocation[victim][j];
		Finish[victim] = true;
		logger.log(`Recovery: Terminated victim P${victim}. Resources reclaimed.`);
		resetTables(victim);
		drawRAG();
	}

	function recoverPreemption() {
		// Preempt one unit of a resource from a process holding the most of it
		let bestJ = -1, bestAmt = -1, bestI = -1;
		for (let j = 0; j < R; j++) {
			for (let i = 0; i < P; i++) if (!Finish[i] && Allocation[i][j] > bestAmt) {
				bestAmt = Allocation[i][j]; bestJ = j; bestI = i;
			}
		}
		if (bestI < 0 || bestAmt <= 0) { logger.log('Preemption not possible.'); return; }
		Allocation[bestI][bestJ] -= 1;
		Work[bestJ] += 1;
		Need[bestI][bestJ] += 1;
		logger.log(`Recovery: Preempted 1 unit of R${bestJ} from P${bestI}.`);
		resetTables(bestI);
		drawRAG();
	}

	// RAG drawing (approximate wait-for graph)
	function drawRAG(showCycle = false) {
		const canvas = el('b-rag');
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const cx = canvas.width / 2, cy = canvas.height / 2;
		const radius = Math.min(cx, cy) - 30;
		const nodes = [];
		for (let i = 0; i < P; i++) {
			const angle = (i / P) * Math.PI * 2;
			nodes.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
		}
		// edges: from waiting process to any process that holds some resource it needs
		const edges = [];
		for (let i = 0; i < P; i++) if (!Finish[i]) {
			let waiting = false;
			for (let j = 0; j < R; j++) if (Need[i][j] > Work[j]) { waiting = true; break; }
			if (!waiting) continue;
			for (let k = 0; k < P; k++) if (!Finish[k] && k !== i) {
				for (let j = 0; j < R; j++) if (Need[i][j] > 0 && Allocation[k][j] > 0) {
					edges.push([i, k]); break;
				}
			}
		}
		// draw edges
		edges.forEach(([a, b]) => {
			ctx.beginPath();
			ctx.strokeStyle = showCycle ? '#ef4444' : '#64748b';
			ctx.moveTo(nodes[a].x, nodes[a].y);
			ctx.lineTo(nodes[b].x, nodes[b].y);
			ctx.stroke();
		});
		// draw nodes with state-based colors
		for (let i = 0; i < P; i++) {
			ctx.beginPath();
			let color = '#22c55e'; // finished (green)
			if (!Finish[i] && detectionManager) {
				const state = detectionManager.getProcessState(`P${i}`);
				switch (state.state) {
					case 'waiting': color = '#c2410c'; break; // orange
					case 'blocked': color = '#1e40af'; break; // blue
					case 'starved': color = '#1f2937'; break; // black
					case 'running': color = '#22c55e'; break; // green
					default: color = '#f59e0b'; // yellow (unknown)
				}
			} else if (!Finish[i]) {
				color = '#f59e0b'; // yellow (waiting)
			}
			ctx.fillStyle = color;
			ctx.arc(nodes[i].x, nodes[i].y, 16, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#ffffff';
			ctx.font = '12px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText('P' + i, nodes[i].x, nodes[i].y + 4);
		}
	}

	// Event bindings
	el('b-start').addEventListener('click', () => { if (!running) startRunning(); });
	el('b-pause').addEventListener('click', () => stopRunning());
	el('b-step').addEventListener('click', () => { stopRunning(); performStep(); });
	el('b-reset').addEventListener('click', () => resetAll());
	el('b-export-log').addEventListener('click', () => logger.exportText('banker-log.txt'));
	el('b-export-json').addEventListener('click', () => logger.exportJSON('banker-log.json'));
	el('b-recover-terminate').addEventListener('click', () => recoverVictimTermination());
	el('b-recover-preempt').addEventListener('click', () => recoverPreemption());

	// Recompute Need on any change in textareas/inputs that affect matrices
	['b-proc','b-res','b-available','b-max','b-allocation'].forEach(id => {
		el(id).addEventListener('change', () => { try { parseInputs(); } catch (e) { logger.log('Input error: ' + e.message); } });
	});

	// init
	try { parseInputs(); } catch (e) { logger.log('Input error: ' + e.message); }
})();



