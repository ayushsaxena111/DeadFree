import { Logger, createActorBadge, setActorState, sleepForSpeed, DetectionManager } from './utils.js';

(() => {
	const logger = new Logger('pc-logs', 'ProducerConsumer');
	const el = id => document.getElementById(id);

	let bufferSize = 8, producers = 2, consumers = 2;
	let buffer = [];
	let running = false, timer = null, itemId = 1;
	let detectionManager = null;
	let cycleCount = 0;

	function reset() {
		bufferSize = Number(el('pc-buffer').value);
		producers = Number(el('pc-producers').value);
		consumers = Number(el('pc-consumers').value);
		buffer = [];
		itemId = 1;
		cycleCount = 0;
		
		// Initialize detection manager with configuration
        const config = {
            starvationThreshold: Number(el('pc-starvation-threshold') ? el('pc-starvation-threshold').value : 15),
            enableStarvationDetection: el('pc-enable-starvation') ? el('pc-enable-starvation').checked : true,
            enableWaitingDetection: el('pc-enable-waiting') ? el('pc-enable-waiting').checked : true,
            enableBlockingDetection: el('pc-enable-blocking') ? el('pc-enable-blocking').checked : true
        };
        detectionManager = new DetectionManager(logger, config);
		
		logger.clear();
		logger.startSession({ BufferSize: bufferSize, Producers: producers, Consumers: consumers, DetectionConfig: config });
		renderActors();
		renderBuffer();
	}

	function renderActors() {
		const pl = el('pc-producers-list'); pl.innerHTML = '';
		const cl = el('pc-consumers-list'); cl.innerHTML = '';
		for (let i = 1; i <= producers; i++) {
			const badge = createActorBadge(`pc-p-${i}`, `Producer ${i}`);
			badge.title = 'Producer - Click for details';
			pl.appendChild(badge);
		}
		for (let i = 1; i <= consumers; i++) {
			const badge = createActorBadge(`pc-c-${i}`, `Consumer ${i}`);
			badge.title = 'Consumer - Click for details';
			cl.appendChild(badge);
		}
	}

	function renderBuffer() {
		const bar = el('pc-buffer-bar');
		bar.innerHTML = '';
		for (let i = 0; i < bufferSize; i++) {
			const slot = document.createElement('div');
			slot.className = 'buffer-slot';
			slot.textContent = buffer[i] != null ? buffer[i] : '';
			bar.appendChild(slot);
		}
	}

	function produce(i) {
		const badge = el(`pc-p-${i}`);
		const actorId = `P${i}`;
		
		if (buffer.length >= bufferSize) {
			// Producer is blocked
			const newState = detectionManager.updateProcessState(actorId, 'blocked', 'buffer full');
			const visualState = newState === 'starved' ? 'black' : 'blue';
			setActorState(badge, visualState);
			badge.title = `Producer ${i} - ${newState.toUpperCase()} (buffer full)`;
			logger.log(`Buffer Full! Producer ${i} blocked.`);
			return false;
		}
		
		// Producer can produce
		detectionManager.updateProcessState(actorId, 'running', 'producing item');
		setActorState(badge, 'green');
		badge.title = `Producer ${i} - RUNNING (producing)`;
		buffer.push(itemId);
		logger.log(`Producer ${i} produced item ${itemId}.`);
		itemId++;
		renderBuffer();
		return true;
	}

	function consume(i) {
		const badge = el(`pc-c-${i}`);
		const actorId = `C${i}`;
		
		if (buffer.length <= 0) {
			// Consumer is blocked
			const newState = detectionManager.updateProcessState(actorId, 'blocked', 'buffer empty');
			const visualState = newState === 'starved' ? 'black' : 'blue';
			setActorState(badge, visualState);
			badge.title = `Consumer ${i} - ${newState.toUpperCase()} (buffer empty)`;
			logger.log(`Buffer Empty! Consumer ${i} blocked.`);
			return false;
		}
		
		// Consumer can consume
		detectionManager.updateProcessState(actorId, 'running', 'consuming item');
		setActorState(badge, 'green');
		badge.title = `Consumer ${i} - RUNNING (consuming)`;
		const item = buffer.shift();
		logger.log(`Consumer ${i} consumed item ${item}.`);
		renderBuffer();
		return true;
	}

	function idleActors() {
		for (let i = 1; i <= producers; i++) {
			const badge = el(`pc-p-${i}`);
			detectionManager.updateProcessState(`P${i}`, 'finished', 'cycle completed');
			setActorState(badge, 'grey');
			badge.title = `Producer ${i} - IDLE`;
		}
		for (let i = 1; i <= consumers; i++) {
			const badge = el(`pc-c-${i}`);
			detectionManager.updateProcessState(`C${i}`, 'finished', 'cycle completed');
			setActorState(badge, 'grey');
			badge.title = `Consumer ${i} - IDLE`;
		}
	}

	function start() {
		if (running) return; running = true;
		const speed = el('pc-speed');
		const loop = async () => {
			if (!running) return;
			cycleCount++;
			
			// Attempt to produce from each producer
			for (let i = 1; i <= producers; i++) produce(i);
			await sleepForSpeed(speed);
			
			// Attempt to consume from each consumer
			for (let i = 1; i <= consumers; i++) consume(i);
			await sleepForSpeed(speed);
			
			idleActors();
			await sleepForSpeed(speed);
			
			if (running) timer = requestAnimationFrame(loop);
		};
		timer = requestAnimationFrame(loop);
	}

	function stop() { running = false; if (timer) cancelAnimationFrame(timer); }

	// Events
	el('pc-start').addEventListener('click', () => { start(); });
	el('pc-pause').addEventListener('click', () => stop());
	el('pc-step').addEventListener('click', () => { stop(); for (let i = 1; i <= producers; i++) produce(i); for (let i = 1; i <= consumers; i++) consume(i); idleActors(); });
	el('pc-reset').addEventListener('click', () => { stop(); reset(); });
	el('pc-export-log').addEventListener('click', () => logger.exportText('producer-consumer-log.txt'));
	el('pc-export-json').addEventListener('click', () => logger.exportJSON('producer-consumer-log.json'));
	// Manual: single producer/consumer click
	el('pc-click-producer').addEventListener('click', () => { const id = 1; produce(id); idleActors(); });
	el('pc-click-consumer').addEventListener('click', () => { const id = 1; consume(id); idleActors(); });

	reset();
})();



