$(function() {
	// Counter to generate unique IDs for each element
	let elementCounter = 0;
	
	// The block width and height
	let blockWidth = 60;
	let blockHeight = 20;

	// Getting jQuery references to the HTML elements
	const $editor = $('#editor');
	const $levelId = $('#level-id');
	const $blockWidth = $('#block-width');
	const $blockHeight = $('#block-height');
	const $widthValue = $('#width-value');
	const $heightValue = $('#height-value');

	// Function to create elements, it does not matter which element
	function createElement(elementData) {

		// Checks if there is an ID for elementData, if not, creates a new id
		// like 'block-0' etc
		const id = elementData.id || `${elementData.type}-${elementCounter++}`;
		const type = elementData.type || 'block';

		// jQuery chaining creating a new element, adding classes and attributes,
		// adding CSS style and appending it to the editor element
		const element = $('<div></div>')
			.addClass('element')
			.addClass(`type-${type}`)
			.attr('id', id)
			.attr('data-type', type)
			.css({
				top: elementData.y || 0,
				left: elementData.x || 0,
				width: elementData.width || 50,
				height: elementData.height || 50,
			})
			.appendTo($editor);
		
		// Making the element editor draggable
		element.draggable({
			containment: "#editor"
		});

		// Creates a listener to the right click and ignores the default behaviour
		// of openign the 'context menu'
		element.on("contextmenu", function (e) {
			e.preventDefault();

			// Asks if the player wants to delete the block
			if (confirm(`Delete this ${type}?`)) {
				$(this).remove();
			}
		});

		return element;
	}

	// Function to collect all elements and gather them in an array to save them
	function collectElements() {
		const elements = [];
		$(".element").each(function () {
			const el = $(this);
			const pos = el.position();
			elements.push({
				id: el.attr('id'),
				x: pos.left,
				y: pos.top,
				width: el.width(),
				height: el.height(),
				type: el.attr('data-type')
			});
		});

		return elements;
	}

	// Function that loads the full level
	function renderLevel(elements) {
		$editor.empty();
		elementCounter = 0;
		elements.forEach(el => {
			createElement(el);
		});
	}

	// Add buttons for each element
	$('#add-block').click(function () {
		createElement({ type: 'block', x: 100, y: 100, width: blockWidth, height: blockHeight });
	});

	$('#add-catapult').click(function () {
		createElement({ type: 'catapult', x: 100, y: 100, width: 60, height: 40 });
	});

	$('#add-enemy').click(function () {
		createElement({ type: 'enemy', x: 100, y: 100, width: 40, height: 40 });
	});

	$('#add-spike').click(function () {
		createElement({ type: 'spike', x: 100, y: 100, width: 30, height: 30 });
	});

	$('#add-coin').click(function () {
		createElement({ type: 'coin', x: 100, y: 100, width: 25, height: 25 });
	});

	// Slider to control the width and height of the type block
	$blockWidth.on('input', function () {
		blockWidth = parseInt($(this).val());
		$widthValue.text(blockWidth);
	});

	$blockHeight.on('input', function () {
		blockHeight = parseInt($(this).val());
		$heightValue.text(blockHeight);
	});

	// Button to save the level
	$('#save-level').click(function () {
		const elements = collectElements();

		if (elements.length === 0) {
			alert('The level is empty. Add some elements before saving.');
			return;
		}

		const id = $levelId.val().trim();
		const payload = { blocks: elements };

		let method, url;
		if (id) {
			method = 'PUT';
			url = '/api/v1/levels/' + encodeURIComponent(id);
		} else {
			method = 'POST';
			url = '/api/v1/levels';
		}

		$.ajax({
			url,
			method,
			contentType: 'application/json',
			data: JSON.stringify(payload),
			success: function (response) {
				alert(response.message + ' (ID = ' + response.id + ')');

				if (!id) {
					$levelId.val(response.id);
				}
			},
			error: function (xhr) {
				const msg = xhr.responseJSON?.error || xhr.responseText || 'Unknown error';
				alert('Error saving level: ' + msg);
			}
		});
	});

	// Button to load the level
	$('#load-level').click(function () {
		const id = $levelId.val().trim();

		if (!id) {
			alert('Please enter a Level ID to load.');
			return;
		}

		const url = '/api/v1/levels/' + encodeURIComponent(id);

		$.ajax({
			url,
			method: 'GET',
			contentType: 'application/json',
			success: function (response) {
				renderLevel(response.blocks || []);
				alert('Level loaded successfully.');
			},
			error: function (xhr) {
				const msg = xhr.responseJSON?.error || xhr.responseText || 'Unknown error';
				alert('Error loading level: ' + msg);
			}
		});
	});

	// Button to delete the level
	$('#delete-level').click(function () {
		const id = $levelId.val().trim();

		if (!id) {
			alert('Please enter a Level ID to delete.');
			return;
		}

		if (!confirm(`Are you sure you want to delete level "${id}"?`)) {
			return;
		}

		const url = '/api/v1/levels/' + encodeURIComponent(id);

		$.ajax({
			url,
			method: 'DELETE',
			success: function () {
				alert('Level deleted.');

				$levelId.val('');
				$editor.empty();
			},
			error: function (xhr) {
				const msg = xhr.responseJSON?.error || xhr.responseText || 'Unknown error';
				alert('Error deleting level: ' + msg);
			}
		});
	});

});