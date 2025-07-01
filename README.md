# HTML/DOM IoT Binding Elements for Browser

Collections of HTML/DOM binding elements for linking DOM elements with physical components in browser environments.

## Bindings

The binding elements link the DOM elements with physical components.

Bindings have two core attributes: `id` and `location`, without which they can't work.
```
<iot-lock-binding id="lockBinding" location="/dev/lock">
<iot-LCD-binding id="LCDBinding" location="/dev/lcd">
```

The `id` attribute identifies the binding so it can be referenced by other elements.

The `location` attribute specifies a reference to the driver with which the binding communicates. This reference can be a file path (as in the example above), a URL, or any other type of reference.

Bindings listen for changes in the attributes of the elements that reference them (including CSS property changes). They parse these attributes into values interpretable by a driver and then communicate these values to that driver. Bindings also consume and interpret values from drivers, updating the DOM accordingly by modifying attributes or dispatching events.

For an element to use a binding, it must include the binding's `id` in its `binding` attribute. An element can use more than one binding. In the following example an `iot-door` element uses two bindings identified by `lockBinding` and `LCDBinding`.
```
<iot-door binding="lockBinding:0 LCDBinding:0" unlocked>
```

Numeric indexes can be specified in the `binding` attribute value to indicate the element's position within the binding, though it is not mandatory. Indexes help indicate the position of parsed values within the driver’s communication message.
```
<iot-door binding="lockBinding LCDBinding" unlocked>
```

In this example, no indexes are specified. Assuming these are the first references to `lockBinding` and `LCDBinding` within an element, the `iot-door` element will have the index `0` in both bindings. The result is the same as in the previous example that specifies indexes.

## WebSocket Communication

We propose that binding elements communicate with drivers through WebSockets using a Binding-to-Driver Communication server (bdcom-server.js). However, the DOMIoT for browser implementation is decoupled from the communication library to avoid enforcing this approach.

## Usage

Include the binding scripts in your HTML:

```
<script src="bdcom.js"></script>
<script src="domiot-browser.js"></script>
<script src="retail-elements.js"></script>
<!-- IoT Bindings -->
<script src="iot-bindings.js"></script>
```

*Note: In the example above, the bdcom.js library, along with the bdcom-server (Binding-to-Driver Communication server), enables binding elements to communicate with drivers via a Binding-to-Driver WebSocket server."*

### Example, mixing the physical world with a web app:

In the following example, physical buttons interact with both physical luminic tiles and web-based divs.

```
<!DOCTYPE html>
<html>
<head>
    <script src="bdcom.js"></script>
    <script src="domiot-browser.js"></script>
    <script src="retail-elements.js"></script>
    <script src="iot-bindings.js"></script>
</head>

<iot-section style="display:none;">
    <!-- Bindings -->
    <iot-ibits-button-binding id="buttonBinding" location="/dev/ihubx24-sim0">
    <iot-obits-color-binding id="colorBinding" channels-per-element="2" colors-channel="white;blue" location="/dev/ohubx24-sim0">
    
    <iot-button id="physicalButton" binding="buttonBinding">
    <iot-tile id="physicalTile" style="color:white;" binding="colorBinding">
</iot-section>

<body>
    <div id="div1" syle="background-color:white;">Press the button to change my background color</div>
</body>
<script>
    // Initialize DOMIoT with element collections
    DOMIoT([retailElements, iotBindings]);

    const physicalButton = document.getElementById('physicalButton');
    const physicalTile = document.getElementById('physicalTile');
    const div1 = document.getElementById('div1');

    // Listen for button press events
    physicalButton.addEventListener('press', (ev) => {
        physicalTile.style.setProperty('color', 'blue'); // Changes physical light color to blue
        div1.style.setProperty('background-color', 'blue');
    });
    
    physicalButton.addEventListener('release', (ev) => {
        physicalTile.style.setProperty('color', 'white'); // Changes physical light color to white
        div1.style.setProperty('background-color', 'white');
    });
</script>
</html>
```

## Available Bindings

### ibits-button (Input)

Binding between drivers such as a hub of input channels communicating with bits and elements that behave like buttons.

**Example:**
```html
<iot-ibits-button-binding id="buttonBinding" location="/dev/ihubx24-sim0">
<iot-button id="btn1" binding="buttonBinding">
<iot-button id="btn2" binding="buttonBinding">
```

The binding reads button state data (0 / 1) from a driver and dispatches press/release events to the elements associated with the binding. In the example above, it will dispatch events to the `iot-button` elements.

Button states are read as strings where each character represents a button state:
```
"011101000000000000000000"  // 24 channels: 0=released, 1=pressed
```

press/release events can be listened using the `addEventListener` method.


This binding can be used with [ihubx24-sim](https://github.com/domiot-io/drivers/tree/main/linux/ihubx24-sim) driver or any driver that implements the same interface such as a [Phidget VINT x6 driver](https://github.com/domiot-io/drivers/tree/main/linux/phidgetvintx6).


### ibits-item (Input)

Binding between drivers such as a hub of input channels and item elements.

**Example:**
```html
<iot-ibits-item-binding id="itemBinding" location="/dev/iohubx24-sim0">
<iot-item id="perfume1" binding="itemBinding"></iot-item>
<iot-item id="perfume2" binding="itemBinding"></iot-item>
```

The binding reads item state data (0 / 1) from a driver and dispatches pickup/putdown events to the elements associated with the binding.

Item states are read as strings where each character represents an item state:
```
"010000000000000000000000"  // 24 channels: 0=put down, 1=picked up
```

pickup/putdown  events can be listened using the `addEventListener` method.

### obits-color (Output)

Binding between drivers such as a hub of output channels and CSS color properties of the elements that reference the binding.

**Example:**
```
<iot-obits-color-binding 
    id="colorBinding" 
    channels-per-element="2" 
    colors-channel="white:0;blue:1" 
    location="/dev/ohubx24-sim0">

<iot-shelving-unit id="myShelvingUnit1" style="color:white;" binding="colorBinding">
<iot-shelving-unit id="myShelvingUnit2" style="color:white;" binding="colorBinding">
```

The binding communicate the color state data (0 / 1) to a driver when color CSS properties change on associated elements, this makes the physical shelving unit to light up in one color or another.

Color states are written as binary strings:
```
"101010000000000000000000"  // 24 channels: 0=off, 1=on
```

This binding can be used with [ohubx24-sim](https://github.com/domiot-io/drivers/tree/main/linux/ohubx24-sim) driver or any driver that implements the same interface.

**Special attributes:**
- `channels-per-element` (optional): Number of channels per element (default: 1).
- `colors-channel` (required): Color-to-channel mapping (format: `"color1:channel1;color2:channel2"`).

**Monitored CSS Properties:**
- `color`: color changes trigger device writes.

### iobits-lock (Input/Output)

Bidirectional binding between an IO driver such as an electronic lock mechanism driver communicating with bits and elements that can be locked/unlocked such as a `<door>`.

**Example:**
```
<iot-iobits-lock-binding id="lockBinding" location="/dev/iohubx24-sim0">
<iot-door id="hotelDoor" locked binding="lockBinding">
```

The binding reads lock state data (0=unlocked, 1=locked) and updates the `locked` attribute on associated elements.
The binding also monitors the `locked` attribute on associated elements and notifies the electronic lock mechanism driver on change.

**Element Attributes:**
- `locked`: Presence indicates locked state, absence indicates unlocked state.

### otext-video (Output)

Binding between video player devices and video elements.

**Example:**
```
<iot-otext-video-binding id="videoBinding" location="/dev/video-sim0">
<iot-video id="productVideo" src="videos/product.mp4" loop autostart binding="videoBinding">
```

The binding writes video commands to the video driver when video properties change.

### otext-attribute (Output)

Binding between text consuming devices such as an LCD display, and elements that need to display text such as a `<door>` with an LCD display.

**Example:**
```
<iot-otext-attribute-binding id="lcdBinding" attribute-name="message" location="/dev/lcd-sim0">
<iot-door id="hotelDoor" message="Welcome to your room!" binding="lcdBinding">
```

The binding writes a message text to a driver when the specified attribute changes. In the example the message "Welcome to your room!" is displayed in the door's LCD screen.

**Special attributes:**
- `attribute-name` (optional): Name of the attribute containing the text. If no attribute-name is provided, the binding will use the 'text' attribute. Only the first 1024 characters of the text are written to the device file.


## Creating Custom Bindings

You can create your own binding and binding collections using `HTMLElementCollection`:

```javascript
const myHomeBindings = new HTMLElementCollection();

myHomeBindings.add('iot-iotext-washing-machine-binding', HTMLIoTIOTextWachingMachineBindingElement);

// Initialize DOMIoT to use my custom bindings
DOMIoT([myHomeBindings, homeBindings, retailElements]);
```

## License

MIT. 
