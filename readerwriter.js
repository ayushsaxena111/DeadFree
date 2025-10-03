import { Logger, createActorBadge, setActorState, setPriorityBar, sleepForSpeed, DetectionManager } from './utils.js';

(() => {
	const logger = new Logger('rw-logs', 'ReaderWriter');
	const el = id => document.getElementById(id);

    let readers = 4, writers = 2, mode = 'fair', threshold = 20;
	let running = false, timer = null;
	let detectionManager = null;

	let state = {
		queue: [], // {type:'R'|'W', id, waitingTicks, priority}
		activeReaders: new Set(),
		activeWriter: null
	};

    function reset() {
		readers = Number(el('rw-readers').value);
		writers = Number(el('rw-writers').value);
		mode = el('rw-mode').value;
		threshold = Number(el('rw-starvation-threshold') ? el('rw-starvation-threshold').value : el('rw-threshold').value);
		
		// Initialize detection manager with configuration
        const config = {
            starvationThreshold: threshold,
            enableStarvationDetection: el('rw-enable-starvation') ? el('rw-enable-starvation').checked : true,
            enableWaitingDetection: el('rw-enable-waiting') ? el('rw-enable-waiting').checked : true,
            enableBlockingDetection: el('rw-enable-blocking') ? el('rw-enable-blocking').checked : true
        };
        detectionManager = new DetectionManager(logger, config);
		
		state = { queue: [], activeReaders: new Set(), activeWriter: null };
        logger.clear();
        logger.startSession({ Readers: readers, Writers: writers, Mode: mode, StarvationThresholdTicks: threshold, DetectionConfig: config });
		renderActors();
	}

	function renderActors() {
		const rl = el('rw-readers-list'); rl.innerHTML = '';
		const wl = el('rw-writers-list'); wl.innerHTML = '';
		for (let i = 1; i <= readers; i++) {
			const badge = createActorBadge(`rw-r-${i}`, `Reader ${i}`);
			badge.title = 'Reader - Click for details';
			rl.appendChild(badge);
		}
		for (let i = 1; i <= writers; i++) {
			const badge = createActorBadge(`rw-w-${i}`, `Writer ${i}`);
			badge.title = 'Writer - Click for details';
			wl.appendChild(badge);
		}
	}

	function enqueueAll() {
		// Simple cycle: all actors enqueue in order R1..Rn, W1..Wm
		state.queue = [];
		for (let i = 1; i <= readers; i++) state.queue.push({ type: 'R', id: i, waitingTicks: 0, priority: 0 });
		for (let i = 1; i <= writers; i++) state.queue.push({ type: 'W', id: i, waitingTicks: 0, priority: 0 });
	}

	function applyAging() {
		state.queue.forEach(a => {
			a.waitingTicks += 1;
			const actorId = `${a.type}${a.id}`;
			const badge = el(a.type === 'R' ? `rw-r-${a.id}` : `rw-w-${a.id}`);
			
			// Update detection manager state
			const newState = detectionManager.updateProcessState(actorId, 'waiting', `waiting for ${a.waitingTicks} ticks`);
			
			// Update visual state based on detection result
			let visualState = 'yellow'; // default waiting
			if (newState === 'starved') {
				visualState = 'black';
				a.priority = Math.min(100, a.priority + 10);
				setPriorityBar(badge, a.priority);
			} else if (a.waitingTicks >= threshold) {
				// Legacy purple state for backward compatibility
				visualState = 'purple';
				a.priority = Math.min(100, a.priority + 10);
				setPriorityBar(badge, a.priority);
			} else {
				visualState = 'orange'; // new waiting state
			}
			
			setActorState(badge, visualState);
			badge.title = `${a.type === 'R' ? 'Reader' : 'Writer'} ${a.id} - ${newState.toUpperCase()} (${a.waitingTicks} ticks)`;
		});
	}

	function scheduleStep() {
		applyAging();
		// If writer active, it holds exclusivity
		if (state.activeWriter) {
			logger.log(`Writer ${state.activeWriter} is writing.`);
			return; // let it continue for now
		}
		// If any readers active and next is reader-pref or fair with reader next
		const nextWriterIdx = state.queue.findIndex(a => a.type === 'W');
		const nextReaderIdx = state.queue.findIndex(a => a.type === 'R');
		const nextWriter = nextWriterIdx >= 0 ? state.queue[nextWriterIdx] : null;
		const nextReader = nextReaderIdx >= 0 ? state.queue[nextReaderIdx] : null;

		// choose by mode + aging (higher priority first when starving)
		let chooseWriter = false;
		if (nextWriter && nextReader) {
			if (nextWriter.priority > nextReader.priority) chooseWriter = true;
			else if (nextReader.priority > nextWriter.priority) chooseWriter = false;
			else chooseWriter = (mode === 'fair') ? (nextWriterIdx < nextReaderIdx) : false;
		} else if (nextWriter) chooseWriter = true;

		if (chooseWriter && nextWriter) {
			// writer gets exclusive
			state.activeWriter = nextWriter.id;
			state.queue.splice(nextWriterIdx, 1);
			const badge = el(`rw-w-${nextWriter.id}`);
			
			// Update detection manager and visual state
			detectionManager.updateProcessState(`W${nextWriter.id}`, 'running', 'writing exclusively');
			setActorState(badge, 'green'); 
			setPriorityBar(badge, 0);
			badge.title = `Writer ${nextWriter.id} - RUNNING (writing)`;
			logger.log(`Writer ${nextWriter.id} is writing.`);
			
			// Update waiting readers and writers
			state.queue.filter(a => a.type === 'R').forEach(a => {
				detectionManager.updateProcessState(`R${a.id}`, 'blocked', 'blocked by active writer');
				setActorState(el(`rw-r-${a.id}`), 'blue'); // blocked state
			});
			state.queue.filter(a => a.type === 'W').forEach(a => {
				detectionManager.updateProcessState(`W${a.id}`, 'waiting', 'waiting for writer to finish');
				setActorState(el(`rw-w-${a.id}`), 'orange'); // waiting state
			});
			return;
		}

		// Otherwise, allow all readers to read concurrently until a writer of higher priority appears
		if (nextReader) {
			const readerBatch = state.queue.filter(a => a.type === 'R');
			readerBatch.forEach(a => {
				state.activeReaders.add(a.id);
				const badge = el(`rw-r-${a.id}`);
				
				// Update detection manager and visual state
				detectionManager.updateProcessState(`R${a.id}`, 'running', 'reading concurrently');
				setActorState(badge, 'green'); 
				setPriorityBar(badge, 0);
				badge.title = `Reader ${a.id} - RUNNING (reading)`;
				logger.log(`Reader ${a.id} is reading.`);
			});
			// remove readers from queue
			state.queue = state.queue.filter(a => a.type !== 'R');
			// writers waiting/blocked
			state.queue.filter(a => a.type === 'W').forEach(a => {
				detectionManager.updateProcessState(`W${a.id}`, 'blocked', 'blocked by active readers');
				setActorState(el(`rw-w-${a.id}`), 'blue'); // blocked state
			});
			return;
		}

		// Nothing to schedule
	}

	function releaseActive() {
		// Release current writer/readers after a tick
		if (state.activeWriter) {
			const badge = el(`rw-w-${state.activeWriter}`);
			detectionManager.updateProcessState(`W${state.activeWriter}`, 'finished', 'completed writing');
			setActorState(badge, 'grey');
			badge.title = `Writer ${state.activeWriter} - FINISHED`;
			logger.log(`Writer ${state.activeWriter} finished.`);
			state.activeWriter = null;
		}
		if (state.activeReaders.size) {
			for (const id of state.activeReaders) {
				const badge = el(`rw-r-${id}`);
				detectionManager.updateProcessState(`R${id}`, 'finished', 'completed reading');
				setActorState(badge, 'grey');
				badge.title = `Reader ${id} - FINISHED`;
				logger.log(`Reader ${id} finished.`);
			}
			state.activeReaders.clear();
		}
		// re-enqueue all actors again to simulate continuous workload
		enqueueAll();
		// mark all as waiting initially with new detection
		state.queue.forEach(a => {
			const badge = el(a.type === 'R' ? `rw-r-${a.id}` : `rw-w-${a.id}`);
			detectionManager.updateProcessState(`${a.type}${a.id}`, 'waiting', 'queued for next cycle');
			setActorState(badge, 'orange'); // new waiting state
			badge.title = `${a.type === 'R' ? 'Reader' : 'Writer'} ${a.id} - WAITING`;
		});
	}

    function start() {
		if (running) return; running = true;
		const speed = el('rw-speed');
		const loop = async () => {
			if (!running) return;
			scheduleStep();
			await sleepForSpeed(speed);
			releaseActive();
			await sleepForSpeed(speed);
			if (running) timer = requestAnimationFrame(loop);
		};
		timer = requestAnimationFrame(loop);
	}

	function stop() { running = false; if (timer) cancelAnimationFrame(timer); }

	// Events
    el('rw-start').addEventListener('click', () => { enqueueAll(); start(); });
	el('rw-pause').addEventListener('click', () => stop());
	el('rw-step').addEventListener('click', () => { stop(); enqueueAll(); scheduleStep(); releaseActive(); });
	el('rw-reset').addEventListener('click', () => { stop(); reset(); });
	el('rw-export-log').addEventListener('click', () => logger.exportText('reader-writer-log.txt'));
	el('rw-export-json').addEventListener('click', () => logger.exportJSON('reader-writer-log.json'));

    // Manual controls
    let nextReaderId = 1, nextWriterId = 1;
    el('rw-next-reader').addEventListener('click', () => {
        const id = nextReaderId; nextReaderId = nextReaderId % readers + 1;
        // if writer active → waiting
        if (state.activeWriter) {
            logger.log(`Reader ${id} is waiting while Writer ${state.activeWriter} is writing`);
            const badge = el(`rw-r-${id}`); setActorState(badge, 'yellow'); return;
        }
        // can join current readers
        state.activeReaders.add(id);
        const badge = el(`rw-r-${id}`); setActorState(badge, 'green');
        logger.log(`Reader ${id} is reading`);
    });
    el('rw-next-writer').addEventListener('click', () => {
        const id = nextWriterId; nextWriterId = nextWriterId % writers + 1;
        // if any reader or writer active → waiting
        if (state.activeWriter || state.activeReaders.size) {
            logger.log(`Writer ${id} is waiting`);
            const badge = el(`rw-w-${id}`); setActorState(badge, 'yellow'); return;
        }
        state.activeWriter = id; const badge = el(`rw-w-${id}`); setActorState(badge, 'red');
        logger.log(`Writer ${id} is writing`);
    });

	reset();
})();


