import { DOM } from '../dom.js';
import { PropertyChangeNotifier } from '../observation/notifier.js';
import {
  defaultExecutionContext,
  Observable
} from '../observation/observable.js';
import { PPPElementDefinition } from './ppp-definitions.js';

const shadowRoots = new WeakMap();
const defaultEventOptions = {
  bubbles: true,
  composed: true,
  cancelable: true
};

function getShadowRoot(element) {
  return element.shadowRoot || shadowRoots.get(element) || null;
}

/**
 * Controls the lifecycle and rendering of a `PPPElement`.
 * @public
 */
export class Controller extends PropertyChangeNotifier {
  /**
   * Creates a Controller to control the specified element.
   * @param element - The element to be controlled by this controller.
   * @param definition - The element definition metadata that instructs this
   * controller in how to handle rendering and other platform integrations.
   * @internal
   */
  constructor(element, definition) {
    super(element);
    this.boundObservables = null;
    this.behaviors = null;
    this.needsInitialization = true;
    this._template = null;
    this._styles = null;
    this._isConnected = false;
    /**
     * The view associated with the custom element.
     * @remarks
     * If `null` then the element is managing its own rendering.
     */
    this.view = null;
    this.element = element;
    this.definition = definition;

    const shadowOptions = definition.shadowOptions;

    if (shadowOptions !== void 0) {
      const shadowRoot = element.attachShadow(shadowOptions);

      if (shadowOptions.mode === 'closed') {
        shadowRoots.set(element, shadowRoot);
      }
    }

    // Capture any observable values that were set by the binding engine before
    // the browser upgraded the element. Then delete the property since it will
    // shadow the getter/setter that is required to make the observable operate.
    // Later, in the connect callback, we'll re-apply the values.
    const accessors = Observable.getAccessors(element);

    if (accessors.length > 0) {
      const boundObservables = (this.boundObservables = Object.create(null));

      for (let i = 0, ii = accessors.length; i < ii; ++i) {
        const propertyName = accessors[i].name;
        const value = element[propertyName];

        if (value !== void 0) {
          delete element[propertyName];
          boundObservables[propertyName] = value;
        }
      }
    }
  }

  /**
   * Indicates whether or not the custom element has been
   * connected to the document.
   */
  get isConnected() {
    Observable.track(this, 'isConnected');

    return this._isConnected;
  }

  setIsConnected(value) {
    this._isConnected = value;
    Observable.notify(this, 'isConnected');
  }

  /**
   * Gets/sets the template used to render the component.
   * @remarks
   * This value can only be accurately read after connect but can be set at any time.
   */
  get template() {
    return this._template;
  }

  set template(value) {
    if (this._template === value) {
      return;
    }

    this._template = value;

    if (!this.needsInitialization) {
      this.renderTemplate(value);
    }
  }

  /**
   * Gets/sets the primary styles used for the component.
   * @remarks
   * This value can only be accurately read after connect but can be set at any time.
   */
  get styles() {
    return this._styles;
  }

  set styles(value) {
    if (this._styles === value) {
      return;
    }

    if (this._styles !== null) {
      this.removeStyles(this._styles);
    }

    this._styles = value;

    if (!this.needsInitialization && value !== null) {
      this.addStyles(value);
    }
  }

  /**
   * Adds styles to this element. Providing an HTMLStyleElement will attach the element instance to the shadowRoot.
   * @param styles - The styles to add.
   */
  addStyles(styles) {
    const target = getShadowRoot(this.element) || this.element.getRootNode();

    if (styles instanceof HTMLStyleElement) {
      target.append(styles);
    } else if (!styles.isAttachedTo(target)) {
      const sourceBehaviors = styles.behaviors;

      styles.addStylesTo(target);

      if (sourceBehaviors !== null) {
        this.addBehaviors(sourceBehaviors);
      }
    }
  }

  /**
   * Removes styles from this element. Providing an HTMLStyleElement will detach the element instance from the shadowRoot.
   * @param styles - the styles to remove.
   */
  removeStyles(styles) {
    const target = getShadowRoot(this.element) || this.element.getRootNode();

    if (styles instanceof HTMLStyleElement) {
      target.removeChild(styles);
    } else if (styles.isAttachedTo(target)) {
      const sourceBehaviors = styles.behaviors;

      styles.removeStylesFrom(target);

      if (sourceBehaviors !== null) {
        this.removeBehaviors(sourceBehaviors);
      }
    }
  }

  /**
   * Adds behaviors to this element.
   * @param behaviors - The behaviors to add.
   */
  addBehaviors(behaviors) {
    const targetBehaviors = this.behaviors || (this.behaviors = new Map());
    const length = behaviors.length;
    const behaviorsToBind = [];

    for (let i = 0; i < length; ++i) {
      const behavior = behaviors[i];

      if (targetBehaviors.has(behavior)) {
        targetBehaviors.set(behavior, targetBehaviors.get(behavior) + 1);
      } else {
        targetBehaviors.set(behavior, 1);
        behaviorsToBind.push(behavior);
      }
    }

    if (this._isConnected) {
      const element = this.element;

      for (let i = 0; i < behaviorsToBind.length; ++i) {
        behaviorsToBind[i].bind(element, defaultExecutionContext);
      }
    }
  }

  /**
   * Removes behaviors from this element.
   * @param behaviors - The behaviors to remove.
   * @param force - Forces unbinding of behaviors.
   */
  removeBehaviors(behaviors, force = false) {
    const targetBehaviors = this.behaviors;

    if (targetBehaviors === null) {
      return;
    }

    const length = behaviors.length;
    const behaviorsToUnbind = [];

    for (let i = 0; i < length; ++i) {
      const behavior = behaviors[i];

      if (targetBehaviors.has(behavior)) {
        const count = targetBehaviors.get(behavior) - 1;

        count === 0 || force
          ? targetBehaviors.delete(behavior) && behaviorsToUnbind.push(behavior)
          : targetBehaviors.set(behavior, count);
      }
    }

    if (this._isConnected) {
      const element = this.element;

      for (let i = 0; i < behaviorsToUnbind.length; ++i) {
        behaviorsToUnbind[i].unbind(element);
      }
    }
  }

  /**
   * Runs connected lifecycle behavior on the associated element.
   */
  onConnectedCallback() {
    if (this._isConnected) {
      return;
    }

    const element = this.element;

    if (this.needsInitialization) {
      this.finishInitialization();
    } else if (this.view !== null) {
      this.view.bind(element, defaultExecutionContext);
    }

    const behaviors = this.behaviors;

    if (behaviors !== null) {
      for (const [behavior] of behaviors) {
        behavior.bind(element, defaultExecutionContext);
      }
    }

    this.setIsConnected(true);
  }

  /**
   * Runs disconnected lifecycle behavior on the associated element.
   */
  onDisconnectedCallback() {
    if (!this._isConnected) {
      return;
    }

    this.setIsConnected(false);

    const view = this.view;

    if (view !== null) {
      view.unbind();
    }

    const behaviors = this.behaviors;

    if (behaviors !== null) {
      const element = this.element;

      for (const [behavior] of behaviors) {
        behavior.unbind(element);
      }
    }
  }

  /**
   * Runs the attribute changed callback for the associated element.
   * @param name - The name of the attribute that changed.
   * @param oldValue - The previous value of the attribute.
   * @param newValue - The new value of the attribute.
   */
  onAttributeChangedCallback(name, oldValue, newValue) {
    const attrDef = this.definition.attributeLookup[name];

    if (attrDef !== void 0) {
      attrDef.onAttributeChangedCallback(this.element, newValue);
    }
  }

  /**
   * Emits a custom HTML event.
   * @param type - The type name of the event.
   * @param detail - The event detail object to send with the event.
   * @param options - The event options. By default bubbles and composed.
   * @remarks
   * Only emits events if connected.
   */
  emit(type, detail, options) {
    if (this._isConnected) {
      return this.element.dispatchEvent(
        new CustomEvent(
          type,
          Object.assign(Object.assign({ detail }, defaultEventOptions), options)
        )
      );
    }

    return false;
  }

  finishInitialization() {
    const element = this.element;
    const boundObservables = this.boundObservables;

    // If we have any observables that were bound, re-apply their values.
    if (boundObservables !== null) {
      const propertyNames = Object.keys(boundObservables);

      for (let i = 0, ii = propertyNames.length; i < ii; ++i) {
        const propertyName = propertyNames[i];

        element[propertyName] = boundObservables[propertyName];
      }

      this.boundObservables = null;
    }

    const definition = this.definition;

    // 1. Template overrides take top precedence.
    if (this._template === null) {
      if (this.element.resolveTemplate) {
        // 2. Allow for element instance overrides next.
        this._template = this.element.resolveTemplate();
      } else if (definition.template) {
        // 3. Default to the static definition.
        this._template = definition.template || null;
      }
    }

    // If we have a template after the above process, render it.
    // If there's no template, then the element author has opted into
    // custom rendering and they will managed the shadow root's content themselves.
    if (this._template !== null) {
      this.renderTemplate(this._template);
    }

    // 1. Styles overrides take top precedence.
    if (this._styles === null) {
      if (this.element.resolveStyles) {
        // 2. Allow for element instance overrides next.
        this._styles = this.element.resolveStyles();
      } else if (definition.styles) {
        // 3. Default to the static definition.
        this._styles = definition.styles || null;
      }
    }

    // If we have styles after the above process, add them.
    if (this._styles !== null) {
      this.addStyles(this._styles);
    }

    this.needsInitialization = false;
  }

  renderTemplate(template) {
    const element = this.element;
    // When getting the host to render to, we start by looking
    // up the shadow root. If there isn't one, then that means
    // we're doing a Light DOM render to the element's direct children.
    const host = getShadowRoot(element) || element;

    if (this.view !== null) {
      // If there's already a view, we need to unbind and remove through dispose.
      this.view.dispose();
      this.view = null;
    } else if (!this.needsInitialization) {
      // If there was previous custom rendering, we need to clear out the host.
      DOM.removeChildNodes(host);
    }

    if (template) {
      // If a new template was provided, render it.
      this.view = template.render(element, host, element);
    }
  }

  /**
   * Locates or creates a controller for the specified element.
   * @param element - The element to return the controller for.
   * @remarks
   * The specified element must have a {@link PPPElementDefinition}
   * registered either through the use of the {@link customElement}
   * decorator or a call to `PPPElement.define`.
   */
  static forCustomElement(element) {
    const controller = element.$pppController;

    if (controller !== void 0) {
      return controller;
    }

    const definition = PPPElementDefinition.forType(element.constructor);

    if (definition === void 0) {
      throw new Error('Missing PPPElement definition.');
    }

    return (element.$pppController = new Controller(element, definition));
  }
}
