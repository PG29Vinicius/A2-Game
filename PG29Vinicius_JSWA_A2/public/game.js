(() => {
	const canvas = document.getElementById('gameCanvas');
	const ctx = canvas.getContext('2d');
	const headerEl = document.querySelector('header');
	const footerEl = document.querySelector('footer');

	// UI Elements for selecting and loading levels
	const levelSelect = document.getElementById('level-select');
	const loadLevelBtn = document.getElementById('load-level-btn');

	const SCALE = 30;
	const API_BASE = 'http://localhost:3000/api/v1';

	const resizeCanvas = () => {
		const headerH = headerEl?.offsetHeight ?? 0;
		const footerH = footerEl?.offsetHeight ?? 0;
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight - headerH - footerH;
	};

	window.addEventListener('resize', resizeCanvas);
	resizeCanvas();

	const pl = planck;
	const Vec2 = pl.Vec2;

	const createWorld = () => {
		const world = new pl.World({
			gravity: Vec2(0, 1)
		})

		const ground = world.createBody();
		ground.createFixture(pl.Edge(Vec2(-100, 0), Vec2(100, 0)), {
			friction: 0.8
		});

		return {world, ground};
	}

	const {world, ground} = createWorld();

	const TIME_STEP = 1 / 60;
	const VELOCITY_ITERS = 8;
	const POSITION_ITERS = 3;

	const BIRD_RADIUS = 0.5;
	const BIRD_START = Vec2(5, 10);
	const PIG_RADIUS = 0.3;

	const BIRD_STOP_SPEED = 0.15;
	const BIRD_STOP_ANGULAR = 0.25;
	const BIRD_IDLE_SECONDS = 1.0;
	const BIRD_MAX_FLIGHT_SECONDS = 15.0;

	// Converts the editor blocks format to the game format
	const convertLevelFormat = (blocks) => {

		// Arrays to store converted objects of different types
		const pigs = [];
		const boxes = [];
		const coins = [];
		const spikes = [];

		// Iterates through each block and converts based on its type
		blocks.forEach(block => {
			const x = (block.x / SCALE);
			const y = (block.y / SCALE);

			// Checks the type and adds to the corresponding array
			if (block.type === 'pig' || block.type === 'enemy') {
				pigs.push({ x, y });
			} else if (block.type === 'block') {
				boxes.push({
					x,
					y,
					width: block.width / SCALE,
					height: block.height / SCALE
				});
			} else if (block.type === 'coin') {
				coins.push({
					x,
					y,
					radius: (block.width / 2) / SCALE
				});
			} else if (block.type === 'spike') {
				spikes.push({
					x,
					y,
					width: block.width / SCALE,
					height: block.height / SCALE
				});
			}
		});

		// Returns an object with elements organized by type
		return {pigs, boxes, coins, spikes};
	};

	let state = {
		levels: [],
		currentLevel: null,
		currentLevelIndex: 0,
		score: 0,
		birdsRemaining: 3,
		isLevelComplete: false,
		pigs: [],
		boxes: [],
		coins: [],
		spikes: [],
		bird: null,
		birdLaunched: false,

		isMouseDown: false,
		mousePos: Vec2(0,0),
		launchVector: Vec2(0,0)
	};

	const setState = (patch) => {
		state = {...state, ...patch};
	}

	let birdIdleTime = 0;
	let birdFlightTime = 0;
	let levelCompleteTimer = null;
	let gameOverTimer = null;

	const resetBirdTimers = () => {
		birdIdleTime = 0;
		birdFlightTime = 0;
	};

	// ---------------
	// Physics with planck
	// ---------------

	const createBox = (x, y, width, height, dynamic=false) => {
		const body = world.createBody({
			position: Vec2(x, y),
			type: dynamic ? 'dynamic' : "static"
		});

		body.createFixture(pl.Box(width/2,height/2), {
			density: 1.0,
			friction: 0.5,
			restitution: 0.1
		});

		return body;
	};

	const createPig = (x, y) => {
		const body = world.createDynamicBody({
			position: Vec2(x, y),
		});

		body.createFixture(pl.Circle(PIG_RADIUS), {
			density: 0.5,
			friction: 0.5,
			restitution: 0.1,
			userData: "pig"
		});

		body.isPig = true;

		return body;
	};

	// Same logic as the other create functions, but for coins
	const createCoin = (x, y, radius = 0.2) => {
		const body = world.createBody({
			position: Vec2(x, y),
			type: 'static'
		});

		body.createFixture(pl.Circle(radius), {
			density: 0,
			friction: 0,
			restitution: 0,
			isSensor: true,
		});

		body.isCoin = true;

		return body;
	};

	// Same logic as the other create functions, but for spikes
	const createSpike = (x, y, width, height) => {
		const body = world.createBody({
			position: Vec2(x, y),
			type: 'static'
		});

		body.createFixture(pl.Box(width/2, height/2), {
			density: 0.1,
			friction: 0.3,
			restitution: 0.5,
			isSensor: true
		});

		body.isSpike = true;

		return body;
	}

	const createBird = () => {
		const body = world.createDynamicBody(BIRD_START);
		body.createFixture(pl.Circle(BIRD_RADIUS), {
			density: 1.5,
			friction: 0.6,
			restitution: 0.4
		});

		body.setLinearDamping(0.35);
		body.setAngularDamping(0.35);
		body.setSleepingAllowed(true);

		return body;
	}

	const destroyBirdIfExists = () => {
		if (state.bird) {
			world.destroyBody(state.bird);
		}
	};

	const clearWorldExceptGround = () => {
		for (let body = world.getBodyList(); body;) {
			const next = body.getNext();
			if(body !== ground) world.destroyBody(body);
			body = next;
		}
	}

	// ---------------
	// Level Utils
	// ---------------

	const initLevel = (levelIndex) => {
		if (levelCompleteTimer) {
			levelCompleteTimer = null;
		}

		if (gameOverTimer) {
			gameOverTimer = null;
		}

		clearWorldExceptGround();

		const level = state.levels[levelIndex];
		if (!level) return;

		const converted = convertLevelFormat(level.blocks || []);

		const boxes = (converted.boxes || []).map(b => createBox(b.x, b.y, b.width, b.height, false)); 
		const pigs = (converted.pigs || []).map(p => createPig(p.x, p.y));
		const coins = (converted.coins || []).map(c => createCoin(c.x, c.y, c.radius));
		const spikes = (converted.spikes || []).map (s => createSpike(s.x, s.y, s.width, s.height));
		const bird = createBird();

		setState({
			pigs,
			boxes,
			coins,
			spikes,
			bird,
			isLevelComplete: false,
			birdLaunched: false,
			birdsRemaining: 30,
			isMouseDown: false,
			mousePos: Vec2(0, 0),
			launchVector: Vec2(0, 0),
			currentLevelIndex: levelIndex
		});
	};

	const resetLevel = () => initLevel(state.currentLevelIndex);

	const nextLevel = () => {
		const next = state.currentLevelIndex + 1;
		if (next < state.levels.length) {
			setState({currentLevelIndex: next});
			initLevel(next);
			return;
		}

		alert("Congratulations. You win!");
		setState({currentLevelIndex: 0, score: 0});
		initLevel(0);
	}

	// ---------------
	// Loading Levels
	// ---------------

	// Loads levels from the server and populates the level select dropdown
	const loadLevelsFromServer = async () => {
		try {
			const levelIds = ['spike1','level1', 'level2', 'level3', 'floor1', 'coin1'];

			const loadedLevels = [];

			for (const id of levelIds) {
				try {
					const response = await fetch(`${API_BASE}/levels/${id}`);
					if (response.ok) {
						const data = await response.json();
						loadedLevels.push({
							id,
							blocks: data.blocks
						});

						const option = document.createElement('option');
						option.value = id;
						option.textContent = id;
						levelSelect.appendChild(option);
					}
				} catch (e) {
					console.error(`Failed to load level ${id}:`, e);
				}
			}

			if (loadedLevels.length === 0) {
				alert('No level was found. Please create levels first.');
				return;
			}

			setState({levels: loadedLevels});
			if (loadedLevels.length > 0) {
				initLevel(0);
			}
		} catch (e) {
			alert(`Failed to load levels: ${e.message}`);
		}
	};

	// ---------------
	// Input Utils
	// ---------------

	const getMouseWorldPos = (event) => {
		const rect = canvas.getBoundingClientRect();
		const mouseX = (event.clientX - rect.left) / SCALE;
		const mouseY = (event.clientY - rect.top) / SCALE;
		return Vec2(mouseX, mouseY);
	};

	const isPointOnBird = (point) => {
		const birdPos = state.bird?.getPosition();
		if (!birdPos) return false;
		return Vec2.distance(birdPos, point) < BIRD_RADIUS;
	};

	// ---------------
	// Listeners
	// ---------------

	canvas.addEventListener('mousedown', (e) => {
		if (state.birdsRemaining <= 0 || state.birdLaunched || !state.bird) return;

		const worldPos = getMouseWorldPos(e);
		if (isPointOnBird(worldPos)) {
			setState({isMouseDown: true, mousePos: worldPos});
		}
	});

	canvas.addEventListener('mousemove', (e) => {
		if (!state.isMouseDown || !state.bird) return;

		const worldPos = getMouseWorldPos(e);
		const launchVector = Vec2.sub(state.bird.getPosition(), worldPos);

		setState({
			mousePos: worldPos,
			launchVector 
		});
	});

	canvas.addEventListener('mouseup', () => {
		if (!state.isMouseDown || !state.bird) return;

		const bird = state.bird;

		bird.setLinearVelocity(Vec2(0,0));
		bird.setAngularVelocity(0);

		const impulse = state.launchVector.mul(5);

		bird.applyLinearImpulse(impulse, bird.getWorldCenter(), true);

		resetBirdTimers();

		setState({
			isMouseDown: false,
			birdLaunched: true,
			birdsRemaining: state.birdsRemaining - 1
		});
	});

	// Loads the selected level from the dropdown
	loadLevelBtn.addEventListener('click', () => {
		const selectedId = levelSelect.value;
		const levelIndex = state.levels.findIndex(l => l.id === selectedId);
		if (levelIndex !== -1) {
			initLevel(levelIndex);
		}
	});

	// ---------------
	// Collision Logic
	// ---------------

	const isGround = (body) => body === ground;

	// Detects the collision between two bodies at the beginning of the contact
	// Works like a trigger to detect when the bird hits coins or spikes
	world.on('begin-contact', (contact) => {
		// Gets the two fixtures (colliders) involved in the contact
		const fixtureA = contact.getFixtureA();
		const fixtureB = contact.getFixtureB();
		// Gets the two bodies associated with the fixtures
		const bodyA = fixtureA.getBody();
		const bodyB = fixtureB.getBody();

		// Coin collision logic
		if (bodyA.isCoin || bodyB.isCoin) {
			const coinBody = bodyA.isCoin ? bodyA : bodyB;
			const otherBody = bodyA.isCoin ? bodyB : bodyA;

			if (otherBody === state.bird) {
				coinBody.isDestroyed = true;

				setState({
					score: state.score + 50
				});
			}
		}

		// Spike collision logic
		if (bodyA.isSpike || bodyB.isSpike) {
			const otherBody	= bodyA.isSpike ? bodyB : bodyA;

			if (otherBody === state.bird && state.birdLaunched) {
				setState({
					birdLaunched: false,
					birdsRemaining : state.birdsRemaining - 1
				});
				destroyBirdIfExists();

				setTimeout(() => {
					if (state.birdsRemaining > 0) {
						respawnBird();
					}
				}, 0);
			}
		}
	});

	// Solves the collision between pigs and other objects
	world.on('post-solve', (contact, impulse) => {
		if (!impulse) return;

		const fixtureA = contact.getFixtureA();
		const fixtureB = contact.getFixtureB();
		const bodyA = fixtureA.getBody();
		const bodyB = fixtureB.getBody();

		if (!(bodyA.isPig || bodyB.isPig)) return;

		const pigBody = bodyA.isPig ? bodyA : bodyB;

		const normalImpulse = impulse.normalImpulses?.[0] ?? 0;

		if (normalImpulse > 2.0) {
			pigBody.isDestroyed = true;
		}
	});

	// ---------------
	// Update Step
	// ---------------

	const updateBirdTimers = () => {
		const bird = state.bird;
		if (!state.birdLaunched || !bird) return;

		birdFlightTime += TIME_STEP;

		const speed = bird.getLinearVelocity().length();
		const ang = Math.abs(bird.getAngularVelocity());

		if (speed < BIRD_STOP_SPEED && ang < BIRD_STOP_ANGULAR && !state.isMouseDown) {
			birdIdleTime += TIME_STEP;
		} else {
			birdIdleTime = 0;
		}
	};

	const shouldRespawnBird = () => {
		const bird = state.bird;
		if (!state.birdLaunched || !bird) return false;

		const pos = bird.getPosition();

		// checking if the bird is potentially out of bounds of the world
		const outRight = pos.x > 50;
		const outLow = pos.y < -10;

		const idleLongEnough = birdIdleTime >= BIRD_IDLE_SECONDS;
		const timedOut = birdFlightTime >= BIRD_MAX_FLIGHT_SECONDS;

		return outRight || outLow || idleLongEnough || timedOut;
	};

	const handlePigCleanup = () => {
		const remaining = state.pigs.filter(pig => {
			if (!pig.isDestroyed) return true;
			world.destroyBody(pig);
			return false;
		});

		const removedCount = state.pigs.length - remaining.length;
		if (removedCount > 0) {
			setState({
				pigs: remaining,
				score: state.score + (removedCount * 100)
			});
		}
	};

	const handleCoinCleanup = () => {
		const remaining = state.coins.filter(coin => {
			if (!coin.isDestroyed) return true;
			world.destroyBody(coin);
			return false;
		});

		setState({
			coins: remaining
		});
	}; 

	const checkLevelComplete = () => {
		if (state.isLevelComplete) return;
		if (state.pigs.length > 0) return;

		setState({
			isLevelComplete: true
		});

		if (!levelCompleteTimer) {
			levelCompleteTimer = setTimeout(() => {
				levelCompleteTimer = null;
				alert("Level complete");
				nextLevel();
			}, 500);
		}
	};

	const respawnBird = () => {
		destroyBirdIfExists();

		const bird = createBird();
		resetBirdTimers();
		setState({
			bird,
			birdLaunched: false,
			isMouseDown: false,
			launchVector: Vec2(0,0)
		});
	};

	const handleBirdLifeCycle = () => {
		if (!shouldRespawnBird()) return;

		if (state.birdsRemaining > 0) {
			respawnBird();
			return;
		}

		if (!state.isLevelComplete && !gameOverTimer) {
			gameOverTimer = setTimeout(() => {
				gameOverTimer = null;
				alert("Game Over");
				resetLevel();
			}, 500);
		}
	};

	const update = () => {
		world.step(TIME_STEP, VELOCITY_ITERS, POSITION_ITERS);

		updateBirdTimers();
		handlePigCleanup();
		handleCoinCleanup();
		checkLevelComplete();
		handleBirdLifeCycle();
	};

	// ---------------
	// Rendering
	// ---------------

	const toCanvasY = (yMeters) => (yMeters * SCALE);

	const drawGround = () => {
		ctx.beginPath();
		ctx.moveTo(0, toCanvasY(0));
		ctx.lineTo(canvas.width, toCanvasY(0));
		ctx.strokeStyle = "#004d40";
		ctx.lineWidth = 2;
		ctx.stroke();
	};

	const drawBoxes = () => {
		state.boxes.forEach(box => {
			const position = box.getPosition();
			const angle = box.getAngle();
			const shape = box.getFixtureList().getShape();
			const vertices = shape.m_vertices;
			ctx.save();
			ctx.translate(position.x * SCALE, toCanvasY(position.y));
			ctx.rotate(-angle);

			ctx.beginPath();
			ctx.moveTo(vertices[0].x * SCALE, -vertices[0].y * SCALE);
			for (let i=1; i < vertices.length; i++){
				ctx.lineTo(vertices[i].x * SCALE, -vertices[i].y * SCALE);
			}
			ctx.closePath();

			ctx.fillStyle = "#795548";
			ctx.fill();
			ctx.restore();
		});
	};

	const drawPigs = () => {
		state.pigs.forEach(pig => {
			const pos = pig.getPosition();
			ctx.beginPath();
			ctx.arc(pos.x * SCALE, toCanvasY(pos.y), PIG_RADIUS * SCALE, 0 , Math.PI * 2);
			ctx.fillStyle = "#8bc34a";
			ctx.fill();
		});
	};

	const drawCoins = () => {
		state.coins.forEach(coin => {
			const pos = coin.getPosition();
			const radius = coin.getFixtureList().getShape().m_radius;
			ctx.beginPath();
			ctx.arc(pos.x * SCALE, toCanvasY(pos.y), radius * SCALE, 0, Math.PI * 2);
			ctx.fillStyle = "#FFD700";
			ctx.fill();
		});
	};

	const drawSpikes = () => {
		state.spikes.forEach(spike => {
			const position = spike.getPosition();
			const angle = spike.getAngle();
			const shape = spike.getFixtureList().getShape();
			const vertices = shape.m_vertices;
			ctx.save();
			ctx.translate(position.x * SCALE, toCanvasY(position.y));
			ctx.rotate(-angle);

			ctx.beginPath();
			ctx.moveTo(vertices[0].x * SCALE, -vertices[0].y * SCALE);
			for (let i=1; i < vertices.length; i++){
				ctx.lineTo(vertices[i].x * SCALE, -vertices[i].y * SCALE);
			}
			ctx.closePath();

			ctx.fillStyle = "#FF0000";
			ctx.fill();
			ctx.restore();
		});
	};

	const drawBird = () => {
		if(!state.bird) return;
		const pos = state.bird.getPosition();
		ctx.beginPath();
		ctx.arc(pos.x * SCALE, toCanvasY(pos.y), BIRD_RADIUS * SCALE, 0 , Math.PI * 2);
		ctx.fillStyle = "#f44336";
		ctx.fill();
	};

	drawLaunchLine = () => {
		if (!state.isMouseDown || !state.bird) return;
		const birdPos = state.bird.getPosition();
		ctx.beginPath();
		ctx.moveTo(birdPos.x * SCALE, toCanvasY(birdPos.y));
		ctx.lineTo(state.mousePos.x * SCALE, toCanvasY(state.mousePos.y));

		ctx.strokeStyle = "#9e9e9e";
		ctx.lineWidth = 2;
		ctx.stroke();
	};

	const drawHUD = () => {
		ctx.fillStyle = "#000";
		ctx.font = "16px Arial";
		ctx.fillText(`Score: ${state.score}`, 10, 20);
		ctx.fillText(`Level: ${state.currentLevelIndex}`, 10, 40);
		ctx.fillText(`Birds Remaining: ${state.birdsRemaining}`, 10, 60);
	};

	const draw = () => {
		ctx.clearRect(0,0, canvas.width, canvas.height);

		drawGround();
		drawBoxes();
		drawSpikes();
		drawPigs();
		drawCoins();
		drawBird();
		drawLaunchLine();
		drawHUD();
	};

	const loop = () => {
		update();
		draw();
		requestAnimationFrame(loop);
	};

	loadLevelsFromServer().then(() => {
		console.log('Levels carregados:', state.levels);
		console.log('Quantidade de levels:', state.levels.length);
		if (state.levels.length > 0) {
			console.log('Primeiro level:', state.levels[0]);
		}
		loop();
	});
})();