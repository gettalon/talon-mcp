export const BROWSER_NAVIGATE = {
    name: "navigate",
    description: "Navigate the browser to a URL, or go back/forward in history.",
    inputSchema: {
        type: "object",
        properties: {
            url: { type: "string", description: "URL to navigate to" },
            direction: {
                type: "string",
                enum: ["back", "forward"],
                description: "Navigate back or forward in history instead of to a URL",
            },
        },
    },
};
export const BROWSER_CLICK = {
    name: "click",
    description: "Click an element on the page by CSS selector, snapshot ref, or visible text.",
    inputSchema: {
        type: "object",
        properties: {
            selector: { type: "string", description: "CSS selector for the element to click" },
            ref: { type: "string", description: "Element ref from snapshot, e.g. '1:e5'" },
            text: { type: "string", description: "Visible text content to match for clicking" },
            timeout: { type: "number", description: "Timeout in ms to wait for element" },
        },
    },
};
export const BROWSER_TYPE = {
    name: "type",
    description: "Type text into inputs, fill fields, submit forms, or press keyboard shortcuts.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["fill", "fill_form", "type_text", "keyboard"],
                description: "Type action: fill (set input value), fill_form (fill multiple fields), type_text (simulate typing), keyboard (press keys)",
            },
            selector: { type: "string", description: "CSS selector for the input element" },
            value: { type: "string", description: "Value to fill into the input (fill, select)" },
            text: { type: "string", description: "Text to type (type_text)" },
            keys: { type: "string", description: "Key or combo: 'Enter', 'Control+a', 'Shift+Tab' (keyboard)" },
            fields: { type: "object", description: 'Object mapping CSS selectors to values for fill_form, e.g. {"#email": "test@test.com"}' },
            clear: { type: "boolean", description: "Clear input before typing (type_text)" },
        },
        required: ["action"],
    },
};
export const BROWSER_READ_PAGE = {
    name: "read_page",
    description: "Read page content: get page info (URL, title), take an accessibility snapshot, extract structured data, or get full page text.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["get_page_info", "snapshot", "extract", "get_page_text"],
                description: "What to read from the page",
            },
            selector: { type: "string", description: "CSS selector to scope extraction (extract)" },
        },
        required: ["action"],
    },
};
export const BROWSER_SCREENSHOT = {
    name: "screenshot",
    description: "Take a screenshot of the current page or a specific element.",
    inputSchema: {
        type: "object",
        properties: {
            selector: { type: "string", description: "CSS selector to screenshot a specific element" },
            full_page: { type: "boolean", description: "Capture the full scrollable page" },
            format: { type: "string", enum: ["png", "jpeg"], description: "Image format (default: jpeg)" },
            quality: { type: "number", description: "JPEG quality 0-100 (default: 60)" },
        },
    },
};
export const BROWSER_EXECUTE_JS = {
    name: "execute_js",
    description: "Execute JavaScript code in the browser page context and return the result.",
    inputSchema: {
        type: "object",
        properties: {
            code: { type: "string", description: "JavaScript code to execute" },
        },
        required: ["code"],
    },
};
export const BROWSER_TABS = {
    name: "tabs",
    description: "Manage browser tabs: list, open, close, or switch tabs.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["get_tabs", "new_tab", "close_tab", "switch_tab"],
                description: "Tab action to perform",
            },
            tab_id: { type: "number", description: "Tab ID for switch_tab or close_tab" },
        },
        required: ["action"],
    },
};
export const BROWSER_SCROLL = {
    name: "scroll",
    description: "Scroll the page, hover over elements, or perform drag-and-drop.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["scroll", "hover", "drag_drop"],
                description: "Interaction action to perform",
            },
            direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction" },
            amount: { type: "number", description: "Scroll amount in pixels" },
            selector: { type: "string", description: "CSS selector for hover target" },
            source: { type: "string", description: "Source CSS selector (drag_drop)" },
            target: { type: "string", description: "Target CSS selector (drag_drop)" },
        },
        required: ["action"],
    },
};
export const BROWSER_NETWORK = {
    name: "network",
    description: "Monitor and control network activity: enable logging, get network log, set custom headers, or go offline.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["enable", "get_log", "set_headers", "set_offline"],
                description: "Network action to perform",
            },
            headers: { type: "object", description: 'Headers object for set_headers, e.g. {"X-Custom": "value"}' },
        },
        required: ["action"],
    },
};
export const BROWSER_CONSOLE = {
    name: "console",
    description: "Retrieve browser console messages or JavaScript errors from the page.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["get_console", "get_errors"],
                description: "What to retrieve: console logs or errors",
            },
        },
        required: ["action"],
    },
};
export const BROWSER_EMULATE = {
    name: "emulate",
    description: "Emulate devices, viewports, media features, or geolocation.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["set_viewport", "emulate_device", "emulate_media", "set_geolocation"],
                description: "Emulation action to perform",
            },
            width: { type: "number", description: "Viewport width" },
            height: { type: "number", description: "Viewport height" },
            mobile: { type: "boolean", description: "Emulate mobile device" },
            deviceScaleFactor: { type: "number", description: "Device scale factor" },
            value: { type: "string", description: "Media feature value for emulate_media" },
            latitude: { type: "number", description: "Latitude for set_geolocation" },
            longitude: { type: "number", description: "Longitude for set_geolocation" },
            accuracy: { type: "number", description: "Accuracy in meters for set_geolocation" },
        },
        required: ["action"],
    },
};
export const BROWSER_PERFORMANCE = {
    name: "performance",
    description: "Analyze page performance: start/stop traces, take memory snapshots, or run Lighthouse audits.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["start_trace", "stop_trace", "memory_snapshot", "lighthouse_audit"],
                description: "Performance action to perform",
            },
            categories: { type: "string", description: "Comma-separated trace categories for start_trace" },
        },
        required: ["action"],
    },
};
export const BROWSER_FORM = {
    name: "form",
    description: "Advanced form handling: fill forms, upload files, select options, or handle dialogs.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["fill_form", "upload_file", "select", "handle_dialog"],
                description: "Form action to perform",
            },
            fields: { type: "object", description: 'Object mapping CSS selectors to values, e.g. {"#email": "test@test.com"}' },
            selector: { type: "string", description: "CSS selector for the form element" },
            value: { type: "string", description: "Value for select action" },
            files: { type: "array", description: "Array of file paths for upload_file", items: { type: "string" } },
        },
        required: ["action"],
    },
};
export const BROWSER_INSPECT = {
    name: "inspect",
    description: "Inspect elements and page state: highlight elements, get box model, get metrics, or get cookies.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["highlight", "get_box_model", "get_metrics", "get_cookies"],
                description: "Inspection action to perform",
            },
            selector: { type: "string", description: "CSS selector for the element to inspect" },
        },
        required: ["action"],
    },
};
export const BROWSER_WAIT = {
    name: "wait",
    description: "Wait for conditions: wait for an element, wait for network idle, or wait for page stability.",
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["wait", "wait_for_network", "wait_for_stable"],
                description: "Wait condition",
            },
            selector: { type: "string", description: "CSS selector to wait for (wait)" },
            timeout: { type: "number", description: "Timeout in ms" },
        },
        required: ["action"],
    },
};
/** All new focused tools */
export const ALL_TOOLS = [
    BROWSER_NAVIGATE,
    BROWSER_CLICK,
    BROWSER_TYPE,
    BROWSER_READ_PAGE,
    BROWSER_SCREENSHOT,
    BROWSER_EXECUTE_JS,
    BROWSER_TABS,
    BROWSER_SCROLL,
    BROWSER_NETWORK,
    BROWSER_CONSOLE,
    BROWSER_EMULATE,
    BROWSER_PERFORMANCE,
    BROWSER_FORM,
    BROWSER_INSPECT,
    BROWSER_WAIT,
];
//# sourceMappingURL=tools.js.map