/**
 * Another simple JavaScript mutex implementation using promises.
 */
class AnotherMutex{constructor(){this._locked=!1,this._queue=[]}lock(){return new Promise((e=>{this._locked?this._queue.push((()=>{e(this._createUnlockFunction())})):(this._locked=!0,e(this._createUnlockFunction()))}))}_createUnlockFunction(){let e=!1;return()=>{e||(e=!0,this._processQueue())}}_processQueue(){if(this._queue.length>0){const e=this._queue.shift();setTimeout((()=>e()),0)}else this._locked=!1}}


/**
 * HTML binding element class for IoT hub-button binding.
 * The binding reads button state data (0 / 1) from a device file and dispatches
 * press/release events to the elements associated with the binding.
 * 
 * Usage:
 * <iot-ibits-button-binding id="buttonBinding" location="/dev/ihubx24-sim0">
 */
class HTMLIoTIBitsButtonBindingElement extends HTMLElement {

    constructor() {
        super();

        // button states: 011101000000000000000000
        this._data = '';

        // elements referencing the binding:
        // {0: <button>, 1: <button>, 2: <button>, ...}
        this.elements = new Map(); 

        // start retreiving data from the device file
        // after the element is loaded.
        this.addEventListener('load', (ev) => {
            this._init();
        });
    }


    /**
     * Callback for when an element attribute is modified
     */
    elementAttributeModified(index, el, attributeName, attributeValue) {
        // do nothing
    }

    /**
     * Callback for when an element attribute with namespace is modified
     */
    elementAttributeNSModified(index, el, namespace, attributeName, attributeValue) {
        // do nothing
    }

    /**
     * Callback for when an element style property is modified
     */
    elementStyleModified(index, el, propertyName, propertyValue) {
        // do nothing
    }

    /**
     * Validates the id and location mandatory attributes
     * of the binding element.
     */
    _validateAttributes() {
        if (!this.id) {
            console.error(`[ERROR] Binding ${this.nodeName} has no 'id' attribute`);
            return false;
        }
        
        const location = this.getAttribute('location');
        if (!location) {
            console.error(`[ERROR] Binding ${this.nodeName} with id=${this.id} has no 'location' attribute`);
            return false;
        }

        return true;
    }

    /**
     * Reads data from the device
     * file and updates the button states.
     */
    _init() {
        const scope = this;

        if (!this._validateAttributes()) {
            return;
        }

        if (this.bdcom) {
            this.bdcom.subscribeRead(this);
        }

        this.buffer = '';
    }

    onData(err, wsMessage) {
        if (err || !wsMessage || !wsMessage.data) {
            console.error(`Error reading device file ${this.location} of binding ${this.nodeName} with id=${this.id} : `, err);
            return;
        }

        const uint8 = new Uint8Array(wsMessage.data);

        const decoder = new TextDecoder('utf-8'); 

        this.buffer += decoder.decode(uint8);

        let lines = this.buffer.split(/\r\n|\r|\n/);

        this.buffer = lines.pop();

        lines.forEach(data => {
            this._onData.call(this, data);
        });
    }

    /**
     * Processes incoming button state data
     * and dispatches press/releaseevents.
     */
    _onData(data){

        for (let i = 0; i < data.length; i++) {
            // skip if no element is associated with this button index
            if (!this.elements || !this.elements.has(i)) {
                continue;
            }
            
            const val = data[i];
            const previousVal = this._data[i];
            
            // skip if button state hasn't changed
            if (previousVal && previousVal == val) {
                continue;
            }
            
            const el = this.elements.get(i);
            
            if (val == 1) {
                // button pressed.
                const pressEvent = new window.Event('press');
                el.dispatchEvent(pressEvent);
            } else {
                // button released.
                const releaseEvent = new window.Event('release');
                el.dispatchEvent(releaseEvent);
            }
        }
        
        this._data = data;
    }
}


/////////////////////////////////////////////////////////////////////////////////////

/**
 * Creates an HTML binding element class for IoT obits-color binding.
 * The binding writes a color state data (0 / 1) to a device file when 
 * color CSS properties change on associated elements.
 * 
 * Elements can use multiple device channels for different colors.
 * 
 * Usage:
 * <iot-obits-color-binding id="colorBinding" channels-per-element="2" colors-channel="white:0;blue:1" location="/dev/ohubx24-sim0">
 * 
 * In this case, each element has 2 channels, and the color channels are white and blue.
 * The white color will be written to the first channel (0),
 * and the blue color will be written to the second channel (1).
 * 
 * So if we have '01' as values for an element,
 * it means that the first channel is off and the second channel is on,
*/
class HTMLIoTOBitsColorBindingElement extends HTMLElement {

    constructor() {
        super();
        this._mtx = new AnotherMutex(); // mutex for thread-safe file writing

        this._data = []; // channels' states: ['0', '1', '0', '1', ...]

        // elements referencing the binding.
        this.elements = new Map();

        // default number of channels per element.
        this._channelsPerElement = 1;
            
        // color channels mapping.
        // Example:
        // {
        //   'white': 0,
        //   'blue': 1
        // }
        this._colorsChannel = {};
        
        // CSS property names to monitor for color changes
        // Default is ['color'], can be customized via color-property-names attribute
        this._colorPropertyNames = ['color'];
        
        // start monitoring style changes
        // after the element is loaded.
        this.addEventListener('load', (ev) => {
            this._init();
        });
    }

    /**
     * Parses the color channels attribute
     * and creates a mapping of color values to element channels.
     * 
     * Supported syntaxes:
     * 1. Simple color list: "white;blue;red" 
     *    - Colors are assigned sequential indices starting from 0
     * 2. All colors with explicit indices: "white:0;blue:1;red:2" or "red:2;white:0;blue:1"
     *    - Uses the specified indices for each color
     * 3. Mixed format (some with indices, some without): "white:0;blue;red:2"
     *    - Falls back to sequential assignment from 0, ignoring all explicit indices
     *    - Emits a warning about the mixed format
     * 
     * If no colors-channel attribute is specified, defaults to "white" with index 0.
     * 
     * Example:
     * <iot-obits-color-binding id="colorBinding" channels-per-element="2" colors-channel="white;blue" location="/dev/ohubx24-sim0">
     * 
     * In this case, each element has 2 channels, and the color channels are white and blue.
     * The white color will be written to the first channel (0),
     * and the blue color will be written to the second channel (1).
     */
    _parseColorsChannel() {
        const colorsChannel = this.getAttribute('colors-channel');
        if (!colorsChannel) {
            // Default to "white" color with index 0
            this._colorsChannel['white'] = 0;
            return;
        }

        const splittedColorsChannels = colorsChannel.split(';');
        const colorEntries = [];
        let allHaveIndices = true;
        let someHaveIndices = false;
        
        // parse all entries and check if they all have explicit indices
        for (let i = 0; i < splittedColorsChannels.length; i++) {
            const entry = splittedColorsChannels[i].trim();
            if (entry.length == 0) {
                continue;
            }
            
            if (entry.includes(':')) {
                const parts = entry.split(':');
                if (parts.length === 2) {
                    const color = parts[0].trim();
                    const indexStr = parts[1].trim();
                    const index = parseInt(indexStr);
                    if (!isNaN(index) && indexStr === index.toString()) {
                        colorEntries.push({ color, index });
                        someHaveIndices = true;
                    } else {
                        allHaveIndices = false;
                        colorEntries.push({ color });
                    }
                } else {
                    allHaveIndices = false;
                    colorEntries.push({ color: entry });
                }
            } else {
                allHaveIndices = false;
                colorEntries.push({ color: entry });
            }
        }
        
        // assign indices
        if (allHaveIndices && colorEntries.length > 0) {
            // use explicit indices
            for (const entry of colorEntries) {
                this._colorsChannel[entry.color.toLowerCase()] = entry.index;
            }
        } else {
            // no explicit indices or some are invalid.
            // assign sequential indices from 0
            if (someHaveIndices && !allHaveIndices) {
                console.warn(`[WARNING] Binding ${this.nodeName} with id=${this.id}: Mixed format detected in 'colors-channel' attribute. Some colors have explicit indices while others don't. Falling back to sequential assignment from 0.`);
            }
            for (let i = 0; i < colorEntries.length; i++) {
                this._colorsChannel[colorEntries[i].color.toLowerCase()] = i;
            }
        }
    }

    ///////////////////////////////////////////////////////////////////////////

    /**
     * Parses the channels-per-element attribute.
     * Channels per element is the number of channels that 
     * each element has. Each channel is reserved for
     * a color value (1/0 on/off).
     * Example:
     * <iot-obits-color-binding id="colorBinding" channels-per-element="2" colors-channel="white:0;blue:1" location="/dev/ohubx24-sim0">
     * 
     * In this case, each element has 2 channels, and the color channels are white and blue.
     * The white color will be written to the first channel (0),
     * and the blue color will be written to the second channel (1).
     * 
     * So if we have '01' as values for an element,
     * it means that the first channel is off and the second channel is on,
     * which means than white is off and blue is on.
     */
    _parseChannelsPerElement() {
        const channelsPerElement = this.getAttribute('channels-per-element');
        if (!channelsPerElement) {
            return;
        }
        try {
            this._channelsPerElement = parseInt(channelsPerElement);
        } catch (error) {
            console.error(`[ERROR] Invalid 'channels-per-element' attribute: ${this._channelsPerElement}`);
        }
    }
    
    /**
     * Validates the id and location mandatory attributes
     * of the binding element.
     */
    _validateAttributes() {
        if (!this.id) {
            console.error(`[ERROR] Binding ${this.nodeName} has no 'id' attribute`);
            return false;
        }
        const location = this.getAttribute('location');
        if (!location) {
            console.error(`[ERROR] Binding ${this.nodeName} with id=${this.id} has no 'location' attribute`);
            return false;
        }
        return true;
    }

    /**
     * Initializes the color binding element
     * and sets up the device file for writing.
     */
    _init() {
        if (!this._validateAttributes()) {
            return;
        }

        this._parseChannelsPerElement();
        this._parseColorsChannel();
        this._parseColorPropertyNames();

    }

    /**
     * Callback for when an element attribute is modified
     */
    elementAttributeModified(index, el, attributeName, attributeValue) {
        // do nothing
    }

    /**
     * Callback for when an element attribute with namespace is modified
     */
    elementAttributeNSModified(index, el, namespace, attributeName, attributeValue) {
        // do nothing
    }

    /**
     * Callback for when an element style property is modified
     */
    elementStyleModified(index, el, propertyName, propertyValue) {
        if (!this._colorPropertyNames.includes(propertyName)) {
            return;
        }

        if (!this.elements.has(index)) {
            return;
        }

        if (!this._colorsChannel) {
            return;
        }
        if (!this.bdcom || !this.bdcom.ws || this.bdcom.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        this._mtx.lock().then((unlock) => {
            try {
                // fill the parts of the data array that are not yet set with 0s.
                const elementLastChannelPos = (index + 1) * this._channelsPerElement - 1;

                if (this._data.length <= elementLastChannelPos) {

                    const difference = elementLastChannelPos + 1 - this._data.length;

                    for (let i = 0; i < difference; i++) {
                        this._data.push('0');
                    }
                }

                propertyValue = propertyValue.trim().toLowerCase();
                // color channel is 0 to (channelsPerElement-1)
                const colorChannel = this._colorsChannel[propertyValue];

                // values are in the format:
                // { 2: '0',
                //   3: '1'}
                let values = new Map();

                const elementFirstChannelPos = index * this._channelsPerElement;

                // set all channels to 0
                for (let i = 0; i < this._channelsPerElement; i++) {
                    values.set(elementFirstChannelPos + i, '0');
                }


                if (typeof colorChannel !== 'undefined' && colorChannel < this._channelsPerElement) {
                    values.set(elementFirstChannelPos + colorChannel, '1');
                }
                
                let isSame = true;

                for (const [pos, value] of values) {
                    if (this._data[pos] != value) {
                        isSame = false;
                        break;
                    }
                }

                if (isSame) {
                    unlock();
                    return;
                }

                for (const [pos, value] of values) {
                    this._data[pos] = value;
                }

                const data = this._data.join('');

                        /**
                 * Writes binary data to the device file
                 * in a thread-safe manner using mutex.
                 * values are in the format:
                 * { 2: '0',
                 *   3: '1'}
                 * where the key is the position in the data array.
                 */

                // write the data to the device file.
                this.bdcom.write(this, data);

                unlock();
            }catch(e){
                unlock();
                console.error(e);
            }
        }).catch((e) => {
            console.error(e);
        });
    }

    /**
     * Parses the color-property-names attribute to determine which CSS properties
     * should be monitored for color changes.
     * 
     * Supported formats:
     * - Single property: "background-color"
     * - Multiple properties: "color background-color border-color"
     * 
     * If no color-property-names attribute is specified, defaults to "color".
     * 
     * Example:
     * <iot-obits-color-binding color-property-names="color background-color" ...>
     */
    _parseColorPropertyNames() {
        const colorPropertyNames = this.getAttribute('color-property-names');
        if (!colorPropertyNames) {
            // Default to monitoring 'color' property
            this._colorPropertyNames = ['color'];
            return;
        }

        // Split by whitespace and filter out empty strings
        this._colorPropertyNames = colorPropertyNames.trim().split(/\s+/).filter(name => name.length > 0);
        
        if (this._colorPropertyNames.length === 0) {
            // Fallback to default if no valid property names found
            this._colorPropertyNames = ['color'];
        }
    }
}

/**
 * Creates an HTML binding element class for IoT iobits-lock binding.
 * The binding reads state data from a device file and updates the 'locked' (0:unlocked, 1:locked)
 * attribute on associated elements. It also writes lock state data (0/1) 
 * to the device file when the 'locked' attribute changes on associated elements.
 * Uses a single I/O channel to control the lock mechanism.
 * 
 * Usage:
 * <iot-iobits-lock-binding id="lockBinding" location="/dev/iohubx24-sim0">
 * <iot-door id="hotelDoor" locked binding="lockBinding">
 */

class HTMLIoTIOBitsLockBindingElement extends HTMLElement {

    constructor() {
        super();
        
        this._data = '';
        
        // elements referencing the binding
        this.elements = new Map();
        
        this.addEventListener('load', (ev) => {
            this._init();
        });
    }

    /**
     * Callback for when an element attribute is modified
     */
    elementAttributeModified(index, el, attributeName, attributeValue) {
        if (attributeName == 'locked') {
            this._updateLockState(index, el);
        }
    }

    /**
     * Callback for when an element attribute with namespace is modified
     */
    elementAttributeNSModified(index, el, namespace, attributeName, attributeValue) {
        // do nothing
    }

    /**
     * Callback for when an element style property is modified
     */
    elementStyleModified(index, el, propertyName, propertyValue) {
        // do nothing
    }

    /**
     * Validates the id and location mandatory attributes
     */
    _validateAttributes() {
        if (!this.id) {
            console.error(`[ERROR] Binding ${this.nodeName} has no 'id' attribute`);
            return false;
        }
        
        const location = this.getAttribute('location');
        if (!location) {
            console.error(`[ERROR] Binding ${this.nodeName} with id=${this.id} has no 'location' attribute`);
            return false;
        }

        // Check if the binding is already in use by another element.
        if (this.elements.size > 1) {
            console.warn(`[WARNING] Binding ${this.nodeName} with id=${this.id} has location "${location}" already in use by another binding. Each lock should have its own dedicated driver file for safety and reliability. Sharing device files between bindings can cause unpredictable behavior and security risks.`);
        }

        return true;
    }

    /**
     * Initializes the lock binding element,
     * sets up the device file,
     * and starts reading from the device
     */
    _init() {
        const scope = this;

        if (!this._validateAttributes()) {
            return;
        }


        // Check initial state from associated elements (channel 0)
        this._syncInitialState();
        
        if (this.bdcom) {
            this.bdcom.subscribeRead(this);
        }

        this.buffer = '';
        
    }

    /**
     * Syncs the initial lock state from associated elements to the device
     */
    _syncInitialState() {
        // Check if element on channel 0 has the locked attribute
        const el = this.elements.get(0);
        if (el) {
            const isLocked = el.hasAttribute('locked');
            const data = isLocked ? '1' : '0';
            this._onData(data);
        } else {
            // default to unlocked if no elements found yet
            const data = '0';
            this._onData(data);
        }
        
    }

    onData(err, wsMessage) {
        if (err || !wsMessage || !wsMessage.data) {
            console.error(`Error reading device file ${this.location} of binding ${this.nodeName} with id=${this.id} : `, err);
            return;
        }

        const uint8 = new Uint8Array(wsMessage.data);

        const decoder = new TextDecoder('utf-8'); 

        this.buffer += decoder.decode(uint8);

        let lines = this.buffer.split(/\r\n|\r|\n/);

        this.buffer = lines.pop();

        lines.forEach(data => {
            this._onData.call(this, data);
        });
    }


    /**
     * Processes incoming lock state data from the device
     * and updates element attributes accordingly
     */
    _onData(data) {

        if (data.length == 0 || this._data.length == 0) {
            return;
        }

        data = data[0];

        if (data === this._data) {
            return;
        }

        const el = this.elements.get(0);

        if (!el) {
            return;
        }

        if (data === '1') {
            el.setAttribute('locked', '');
        } else {
            el.removeAttribute('locked');
        }

    }

    /**
     * Updates the lock state based
     * on the element's locked attribute.
     * Writes the new lock state to the device file.
     */
    _updateLockState(index, el) {
        if (!this.bdcom || !this.bdcom.ws || this.bdcom.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        const isLocked = el.hasAttribute('locked');
        const newLockState = isLocked ? '1' : '0';

        if (newLockState === this._data) {
            return;
        }
        
        this._data = newLockState;

        this.bdcom.write(this, newLockState);
        
    }
}


/////////////////////////////////////////////////////////////////////////////////////

/**
 * Creates an HTML binding element class for IoT text - message binding.
 * The binding writes message text to a device file accepting text
 * such as an LCD display device file when 
 * the 'message' attribute changes on associated door elements.
 * 
 * Usage:
 * <iot-otext-message-binding id="lcdBinding" location="/dev/lcd-sim0">
 * <iot-door id="hotelDoor" message="Welcome to your room!" binding="lcdBinding">
 */
class HTMLIoTOTextMessageBindingElement extends window.HTMLElement {

    constructor() {
        super();

        // Current message sent to device.
        this._currentMessage = '';
        
        // elements referencing the binding
        this.elements = new Map();
        
        // start monitoring attribute changes after the element is loaded
        this.addEventListener('load', (ev) => {
            this._init();
        });
    }

    /**
     * Callback for when an element attribute is modified
     */
    elementAttributeModified(index, el, attributeName, attributeValue) {
        if (attributeName === 'message') {
            this._updateMessage(index, el);
        }
    }

    /**
     * Callback for when an element attribute with namespace is modified
     */
    elementAttributeNSModified(index, el, namespace, attributeName, attributeValue) {
        // do nothing
    }

    /**
     * Callback for when an element style property is modified
     */
    elementStyleModified(index, el, propertyName, propertyValue) {
        // do nothing
    }

    /**
     * Validates the id and location mandatory attributes
     */
    _validateAttributes() {
        if (!this.id) {
            console.error(`[ERROR] Binding ${this.nodeName} has no 'id' attribute`);
            return false;
        }
        
        const location = this.getAttribute('location');
        if (!location) {
            console.error(`[ERROR] Binding ${this.nodeName} with id=${this.id} has no 'location' attribute`);
            return false;
        }

        return true;
    }

    /**
     * Initializes the device message binding element and sets up the device file
     */
    _init() {
        if (!this._validateAttributes()) {
            return;
        }
        
        // Initialize with empty message
        this._writeMessage('');
    }

    /**
     * Updates the device message based on the door element's message attribute
     */
    _updateMessage(index, el) {
        const newMessage = el.getAttribute('message') || '';
        
        if (this._currentMessage !== newMessage) {
            this._currentMessage = newMessage;
            this._writeMessage(newMessage);
        }
    }

    /**
     * Writes the message to the device file
     */
    _writeMessage(message) {
        if (!this.bdcom || !this.bdcom.ws || this.bdcom.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        // Device driver expects plain text (up to 120 characters)
        const displayMessage = message.substring(0, 120);

        this.bdcom.write(this, displayMessage);
    }
}

/////////////////////////////////////////////////////////////////////////////////////

/**
 * HTML binding element class for IoT item binding.
 * The binding reads item state data (0 / 1) from a device file and dispatches
 * pickup/putdown events to the elements associated with the binding.
 * 
 * Usage:
 * <iot-ibits-item-binding id="itemBinding" location="/dev/iohubx24-sim0">
 * <iot-item id="perfume1" binding="itemBinding.0"></iot-item>
 */
class HTMLIoTIBitsItemBindingElement extends HTMLElement {

    constructor() {
        super();

        // item states: 011101000000000000000000
        this._data = '';

        // elements referencing the binding:
        // {0: <item>, 1: <item>, 2: <item>, ...}
        this.elements = new Map(); 

        // start retrieving data from the device file
        // after the element is loaded.
        this.addEventListener('load', (ev) => {
            this._init();
        });

        // WebSocket data buffer for line processing
        this.buffer = '';
    }

    /**
     * Callback for when an element attribute is modified
     */
    elementAttributeModified(index, el, attributeName, attributeValue) {
        // do nothing - this is input only
    }

    /**
     * Callback for when an element attribute with namespace is modified
     */
    elementAttributeNSModified(index, el, namespace, attributeName, attributeValue) {
        // do nothing
    }

    /**
     * Callback for when an element style property is modified
     */
    elementStyleModified(index, el, propertyName, propertyValue) {
        // do nothing - this is input only
    }

    /**
     * Validates the id and location mandatory attributes
     * of the binding element.
     */
    _validateAttributes() {
        if (!this.id) {
            console.error(`[ERROR] Binding ${this.nodeName} has no 'id' attribute`);
            return false;
        }
        
        const location = this.getAttribute('location');
        if (!location) {
            console.error(`[ERROR] Binding ${this.nodeName} with id=${this.id} has no 'location' attribute`);
            return false;
        }

        return true;
    }

    /**
     * Initializes the binding and subscribes to device data
     */
    _init() {
        if (!this._validateAttributes()) {
            return;
        }

        if (this.bdcom) {
            this.bdcom.subscribeRead(this);
        }
    }

    /**
     * WebSocket data callback - processes incoming item state data
     */
    onData(err, wsMessage) {
        if (err || !wsMessage || !wsMessage.data) {
            console.error(`Error reading device file ${this.location} of binding ${this.nodeName} with id=${this.id} : `, err);
            return;
        }

        const uint8 = new Uint8Array(wsMessage.data);
        const decoder = new TextDecoder('utf-8'); 
        this.buffer += decoder.decode(uint8);

        let lines = this.buffer.split(/\r\n|\r|\n/);
        this.buffer = lines.pop();

        lines.forEach(data => {
            this._onData.call(this, data);
        });
    }

    /**
     * Processes incoming item state data
     * and dispatches pickup/putdown events.
     */
    _onData(data) {
        for (let i = 0; i < data.length; i++) {
            // skip if no element is associated with this item index
            if (!this.elements || !this.elements.has(i)) {
                continue;
            }
            
            const val = data[i];
            const previousVal = this._data[i];
            
            // skip if item state hasn't changed
            if (previousVal && previousVal == val) {
                continue;
            }
            
            const el = this.elements.get(i);
            
            if (val == 1) {
                // item picked up.
                const pickupEvent = new Event('pickup');
                el.dispatchEvent(pickupEvent);
            } else {
                // item put down.
                const putdownEvent = new Event('putdown');
                el.dispatchEvent(putdownEvent);
            }
        }
        
        this._data = data;
    }
}

/////////////////////////////////////////////////////////////////////////////////////

/**
 * HTML binding element class for video-sim driver communication.
 * The binding writes video commands to /dev/video-sim0 and reads responses.
 * 
 * Output commands sent to device:
 * SET SRC=<video_url>
 * LOAD
 * PLAY
 * PAUSE
 * SET CURRENT_TIME=<seconds>
 * SET LOOP=<boolean>
 * 
 * Input responses from device:
 * CURRENT_TIME=<seconds>   (dispatches 'timeupdate' event)
 * END                      (dispatches 'ended' event when loop=false)
 * 
 * Usage:
 * <iot-otext-video-binding id="videoBinding" location="/dev/video-sim0">
 * <video id="myVideo" src="video.mp4" binding="videoBinding.0"></video>
 */
class HTMLIoTOTextVideoBindingElement extends HTMLElement {

    constructor() {
        super();
        this._currentSrc = '';
        this._isPlaying = false;
        this._currentTime = 0;
        this._duration = 20;
        this._loop = false;
        this.elements = new Map();
        
        // WebSocket data buffer for line processing
        this.buffer = '';
        
        this.addEventListener('load', () => {
            this._init();
        });
    }

    /**
     * Callback for when an element attribute is modified
     */
    elementAttributeModified(index, el, attributeName, attributeValue) {
        if (attributeName === 'src') {
            this._writeSrc(el.getAttribute('src'));
        } else if (attributeName === 'loop') {
            this._writeLoop(el.hasAttribute('loop'));
        }
    }

    /**
     * Callback for when an element attribute with namespace is modified
     */
    elementAttributeNSModified(index, el, namespace, attributeName, attributeValue) {
        // do nothing
    }

    /**
     * Callback for when an element style property is modified
     */
    elementStyleModified(index, el, propertyName, propertyValue) {
        // do nothing
    }

    /**
     * Validates the id and location mandatory attributes
     */
    _validateAttributes() {
        if (!this.id) {
            console.error(`[ERROR] Binding ${this.nodeName} has no 'id' attribute`);
            return false;
        }
        
        const location = this.getAttribute('location');
        if (!location) {
            console.error(`[ERROR] Binding ${this.nodeName} with id=${this.id} has no 'location' attribute`);
            return false;
        }

        return true;
    }

    /**
     * Initializes the binding element
     */
    _init() {
        if (!this._validateAttributes()) {
            return;
        }

        if (this.bdcom) {
            this.bdcom.subscribeRead(this);
        }

        const el = this.elements.get(0);
        if (!el) return;

        this._setupVideoElement(el);

        // Send initial commands
        const initialSrc = el.getAttribute('src') || el.src;
        if (initialSrc) {
            this._writeSrc(initialSrc);
        }

        const initialLoop = el.hasAttribute('loop') || el.loop;
        this._writeLoop(initialLoop);

        // Handle autoplay
        const shouldAutoplay = el.hasAttribute('autoplay') || el.autoplay;
        if (shouldAutoplay && initialSrc) {
            // Send LOAD then PLAY for autoplay
            setTimeout(() => {
                this._writeCommand('LOAD');
                setTimeout(() => {
                    this._writeCommand('PLAY');
                }, 100);
            }, 100);
        }
    }

    /**
     * Sets up video element behavior by overriding methods and properties
     */
    _setupVideoElement(el) {
        const binding = this;

        // Override methods
        el.play = function() {
            binding._isPlaying = true;
            binding._writeCommand('PLAY');
            this._paused = false;
            this._ended = false;
            this.dispatchEvent(new Event('play'));
            setTimeout(() => {
                if (binding._isPlaying) {
                    this.dispatchEvent(new Event('playing'));
                }
            }, 50);
            return Promise.resolve();
        };

        el.load = function() {
            binding._writeCommand('LOAD');
            binding._currentTime = 0;
            this._currentTime = 0;
            this._ended = false;
            this.dispatchEvent(new Event('loadstart'));
            setTimeout(() => {
                this._duration = binding._duration;
                this.dispatchEvent(new Event('loadeddata'));
            }, 100);
        };

        el.pause = function() {
            binding._isPlaying = false;
            binding._writeCommand('PAUSE');
            this._paused = true;
            this.dispatchEvent(new Event('pause'));
        };

        el.seek = function(time) {
            binding._writeCommand(`SET CURRENT_TIME=${time}`);
            binding._currentTime = time;
            this._currentTime = time;
            this.dispatchEvent(new Event('timeupdate'));
        };

        // Override properties
        Object.defineProperty(el, 'currentTime', {
            get: () => binding._currentTime,
            set: function(value) {
                const newTime = Math.max(0, Math.min(value, binding._duration));
                if (binding._currentTime !== newTime) {
                    binding._currentTime = newTime;
                    binding._writeCommand(`SET CURRENT_TIME=${newTime}`);
                    this.dispatchEvent(new Event('timeupdate'));
                }
            },
            configurable: true
        });

        Object.defineProperty(el, 'duration', {
            get: () => binding._duration,
            configurable: true
        });

        Object.defineProperty(el, 'paused', {
            get: () => !binding._isPlaying,
            configurable: true
        });

        Object.defineProperty(el, 'ended', {
            get: function() { return this._ended || false; },
            configurable: true
        });

        Object.defineProperty(el, 'loop', {
            get: () => binding._loop,
            set: function(value) {
                const newLoop = Boolean(value);
                if (binding._loop !== newLoop) {
                    binding._loop = newLoop;
                    binding._writeLoop(newLoop);
                    if (newLoop) {
                        this.setAttribute('loop', '');
                    } else {
                        this.removeAttribute('loop');
                    }
                }
            },
            configurable: true
        });

        Object.defineProperty(el, 'src', {
            get: function() { return this.getAttribute('src') || ''; },
            set: function(value) {
                if (value) {
                    this.setAttribute('src', value);
                } else {
                    this.removeAttribute('src');
                }
                this.dispatchEvent(new Event('loadstart'));
            },
            configurable: true
        });
    }

    /**
     * WebSocket data callback - processes incoming video responses
     */
    onData(err, wsMessage) {
        if (err || !wsMessage || !wsMessage.data) {
            console.error(`[ERROR] iotext-video binding ${this.id}: Read error:`, err);
            return;
        }

        const uint8 = new Uint8Array(wsMessage.data);
        const decoder = new TextDecoder('utf-8'); 
        this.buffer += decoder.decode(uint8);

        let lines = this.buffer.split(/\r\n|\r|\n/);
        this.buffer = lines.pop();

        lines.forEach(data => {
            this._onData(data);
        });
    }

    /**
     * Processes incoming data from the device file
     */
    _onData(data) {
        const trimmedData = data.trim();
        const el = this.elements.get(0);
        if (!el) return;
        
        if (trimmedData === 'END') {
            this._isPlaying = false;
            this._currentTime = this._duration;
            el._ended = true;
            el._paused = true;
            el._currentTime = this._duration;
            el.dispatchEvent(new Event('ended'));
        } else if (trimmedData.startsWith('CURRENT_TIME=')) {
            const timeStr = trimmedData.substring('CURRENT_TIME='.length);
            const time = parseFloat(timeStr);
            if (!isNaN(time)) {
                this._currentTime = time;
                el._currentTime = time;
                el.dispatchEvent(new Event('timeupdate'));
            }
        }
    }

    /**
     * Writes a command to the device file
     */
    _writeCommand(command) {
        if (!this.bdcom || !this.bdcom.ws || this.bdcom.ws.readyState !== WebSocket.OPEN) {
            return;
        }
        this.bdcom.write(this, command);
    }

    /**
     * Writes the video src to the device file
     */
    _writeSrc(src) {
        if (!src || this._currentSrc === src) return;
        this._currentSrc = src;
        this._writeCommand(`SET SRC=${src}`);
    }

    /**
     * Writes the loop state to the device file
     */
    _writeLoop(loop) {
        this._loop = loop;
        this._writeCommand(`SET LOOP=${loop ? 'TRUE' : 'FALSE'}`);
    }
}

/////////////////////////////////////////////////////////////////////////////////////

/**
 * HTML binding element class for IoT text - attribute binding.
 * The binding writes a given attribute text to a device file accepting text
 * such as an LCD display device file when 
 * the given attribute changes on associated elements.
 * The driver file receives the name of the attribute and the text:
 * <attribute-name>=<text>
 * Examples: text="Welcome to DOMIoT Hotel! Have a nice stay!"
 * 
 * If no attribute-name is provided, the binding will use the 'text' attribute.
 * Only the first 1024 characters of the text are written to the device file.
 * 
 * Usage:
 * <iot-otext-attribute-binding id="lcdBinding" attribute-name="message" location="/dev/lcd-sim0">
 * <iot-door id="door" message="Welcome to DOMIoT Hotel! Have a nice stay!" binding="lcdBinding">
 */
class HTMLIoTOTextAttributeBindingElement extends HTMLElement {

    constructor() {
        super();

        this._attributeName = 'text'; // default attribute name

        // Current text sent to device.
        this._currentText = '';
        
        // elements referencing the binding
        // this binding will only use the first
        // element referencing it.
        this.elements = new Map();
        
        // start monitoring attribute changes after the element is loaded
        this.addEventListener('load', (ev) => {
            this._init();
        });
    }

    /**
     * Callback for when an element attribute is modified
     */
    elementAttributeModified(index, el, attributeName, attributeValue) {
        if (attributeName === this._attributeName) {
            this._writeText(el.getAttribute(this._attributeName));
        }
    }

    /**
     * Callback for when an element attribute with namespace is modified
     */
    elementAttributeNSModified(index, el, namespace, attributeName, attributeValue) {
        // do nothing
    }

    /**
     * Callback for when an element style property is modified
     */
    elementStyleModified(index, el, propertyName, propertyValue) {
        // do nothing
    }

    /**
     * Validates the id and location mandatory attributes
     */
    _validateAttributes() {
        if (!this.id) {
            console.error(`[ERROR] Binding ${this.nodeName} has no 'id' attribute`);
            return false;
        }
        
        const location = this.getAttribute('location');
        if (!location) {
            console.error(`[ERROR] Binding ${this.nodeName} with id=${this.id} has no 'location' attribute`);
            return false;
        }

        return true;
    }

    /**
     * Initializes the binding element
     * and sets up WebSocket communication for writing text.
     */
    _init() {
        if (!this._validateAttributes()) {
            return;
        }

        this._attributeName = this.getAttribute('attribute-name') || 'text';

        const el = this.elements.get(0);
        if (!el) {
            return;
        }

        this._writeText(el.getAttribute(this._attributeName));
    }

    /**
     * Writes the text to the device file
     */
    _writeText(text) {

        if (!text || this._currentText == text) {
            return;
        }

        if (!this.bdcom || !this.bdcom.ws || this.bdcom.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        const message = this._attributeName + '=' + text.substring(0, 1024);

        this._currentText = text;
        
        this.bdcom.write(this, message);
    }
}

/////////////////////////////////////////////////////////////////////////////////////

let iotBindings = new HTMLElementCollection();
iotBindings.add('iot-ibits-button-binding', HTMLIoTIBitsButtonBindingElement);
iotBindings.add('iot-obits-color-binding', HTMLIoTOBitsColorBindingElement);
iotBindings.add('iot-iobits-lock-binding', HTMLIoTIOBitsLockBindingElement);
iotBindings.add('iot-otext-message-binding', HTMLIoTOTextMessageBindingElement);
iotBindings.add('iot-ibits-item-binding', HTMLIoTIBitsItemBindingElement);
iotBindings.add('iot-otext-video-binding', HTMLIoTOTextVideoBindingElement);
iotBindings.add('iot-otext-attribute-binding', HTMLIoTOTextAttributeBindingElement);