import * as React from 'react'
import extend = require('extend')
import assign = require('lodash/assign')
import cloneDeepWith = require('lodash/cloneDeepWith')
import merge = require('lodash/merge')
import * as moment from 'moment'
import StoreManager from './store-manager'
import ActionManager from './actions/manager'
import StoreContext, { Manager } from './context'

export const useStore = <T>(store : Store<T>) : T => {
    const [storeState, setStoreState] = React.useState(store.getState())

    React.useEffect(() => {
        store.listen(setStoreState)

        return () => {
            store.ignore(setStoreState)
        }
    })

    return storeState
}

export interface StateHistory<T>
{
    actionName : string
    state : T
}

export interface StoreConfig
{
    async : boolean
    flushRate : number
    highPerformance : boolean
    meshKey : string | null
}

export interface StoreDump<T>
{
    state : T
}

const DEFAULT_CONFIG : StoreConfig = {
    async: false,
    flushRate: 10,
    highPerformance: false,
    meshKey: null
}

/**
 * Store that hooks into actions
 * 
 * Store holds all data and is the only class that should modify the data,
 * anything that pulls data from the DataStore cannot modify it and should treat
 * it as immutable
 */
abstract class Store<T>
{
    public static ACTION_SEED = '__STORE_STATE_SEED__'

    public uuid : string

	public config : StoreConfig = DEFAULT_CONFIG
	
    /**
     * Holds our state
     */
    protected state : T = null

    /**
     *  If state history is enabled, all state changes are saved here
     */
    protected stateHistory : StateHistory<T>[] = []
    
    /**
     * Hold our listeners, whenever the store's state changes, they will be
     * notified, and sent the new state, and old state
     */
    protected listeners : ((...any) => any)[] = []

    /**
     * High performance loads will only dispatch state updates on requestAnimationFrame
     */
    protected highPerformance : boolean

    /**
     * Used to signify if the state is dirty and we should send a notify
     */
    protected dirtyState : boolean

    /**
     * 
     */
    protected _nextState : T = null

    /**
     * Whether or not we are in debug mode
     */
    public debug : boolean = false

    protected pendingActions : string[] = []

    protected __seedFunctions : any[]

    constructor()
    {
        this.dirtyState = false

        this.listen = this.listen.bind(this)
        this.ignore = this.ignore.bind(this)
        this.stateChange = this.stateChange.bind(this)
        this.newState = this.newState.bind(this)
        this.nextState = this.nextState.bind(this)
        this.cloneState = this.cloneState.bind(this)
        this.notify = this.notify.bind(this)
        this.upsertItem = this.upsertItem.bind(this)
        this.removeItem = this.removeItem.bind(this)
        this.removeItems = this.removeItems.bind(this)
        this.__onSeed = this.__onSeed.bind(this)

        StoreManager.register(this)
	}
	
	public static subscribe<C, T>(onUpdate : (componentState : C, nextStoreState : T, oldStoreState : T) => Partial<C>)
	{
		return Store.subscribeTo.bind(this, onUpdate)
	}

	public static subscribeTo<C, T, P extends {new(...args:any[]):{}}>(onUpdate : (componentState : C, nextStoreState : T, oldStoreState : T) => Partial<C>, constructor : P)
    {
        const storeType = this
        
        const storeName = this['name']

        const construct : any = constructor

        return class extends construct{

            static contextType = StoreContext
            
            __listeners : number[] = []

			constructor(args : any)
			{
                super(args)

                const props = args

                const store = props._manager.getStore(storeName, storeType)
                this.state = onUpdate(this.state ? this.state as C : {} as C, store.getState(), {} as T)
                
            }

            componentDidMount()
            {
                super['componentDidMount'] ? super['componentDidMount']() : null
                const store = this.props._manager.getStore(storeName, storeType)
                this.__listeners.push(store.listen((nextState, oldState) => this.setState(onUpdate(this.state, nextState, oldState))))
            }

            componentWillUnmount()
            {
                //super.componentWillUnmount()
                const store = this.props._manager.getStore(storeName, storeType)
                this.__listeners.forEach(index => {
                    store.ignore(index)
                })
            }
        }
    }

    public static Config(config : Partial<StoreConfig>)
    {
        return function<P extends {new(...args:any[]):{}}>(constructor : P) {
            return class extends constructor {
                config = extend(true, {}, DEFAULT_CONFIG, config)
            }
        }
    }

    public static OnSeed<T>(cb : (p : Partial<T>) => any)
    {
        return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
            if(typeof target.__seedFunctions === 'undefined') {
                target.__seedFunctions = []
            }

            target.__seedFunctions.push({
                method: propertyKey,
                cb: cb
            })
        };
    }

    public isDirty() : boolean
    {
        return this.dirtyState
    }
	//TODO: Change to static -> and then use the context manager to create/seed the proper store
    public seed(partialState : any)
    {
        if(typeof partialState !== 'object' || typeof partialState.state !== 'object') {
            console.warn("Invalid object supplied to store seed: ", partialState)
            return
        }

        let nextState = this.nextState()

        for(let key in nextState) {
            let value = nextState[key]
            let newValue = partialState.state[key]
            if(typeof newValue === 'undefined') {
                return
            }

            if(Array.isArray(value) && Array.isArray(newValue)) {
                nextState[key] = value.concat(newValue) as any
                continue
            }

            if(typeof value === 'undefined') {
                nextState[key] = newValue
            }
        }

        ActionManager.dispatch(`${Store.ACTION_SEED}_${this.uuid}`, [nextState])
    }

    public dump() : string
    {
        return JSON.stringify({
            state: this.state
        })
    }

    public clear()
    {

    }

    /**
     * Listen on a given event
     */
    public listen(callback : ((...args : any[]) => any)) : number
    {
        return this.listeners.push(callback)
    }

    /**
     * Return our current state
     */
    public getState() : T
    {
        return this.state
    }

    /**
     * Ignore an event we are listening on
     */
    public ignore(callback : ((...args : any[]) => any) | number) : boolean
    {
        let index
        
        if(typeof callback === 'function') {
            index = this.listeners.indexOf(callback)
        } else {
            index = callback - 1
        }

        if(index >= 0) {
            this.listeners.splice(index, 1)
            return true
        }

        return false
    }

    /**
     * Change the state
     */
    public stateChange(actionName : string, nextState : T) 
    {
        if(this.debug) {
            console.debug(`${actionName} dispatched`, nextState)
        }

        this.pendingActions.push(actionName)
        this._nextState = nextState
        if(!this.dirtyState) {
            this.dirtyState = true
            StoreManager.queueFlush(this)
        }
    }

    /**
     * Flush state change to store and inform listeners
     */
    public flush()
    {
        let oldState : any = {}
        assign(oldState, this.state)
         
        this.state = this._nextState
        this._nextState = null

        if(this.debug) {
            this.stateHistory.push({
                actionName: this.pendingActions.join(','),
                state: oldState
            })
        }

        this.notify(oldState)
    }

    /**
     * Clonse the current state
     */
    public cloneState() : T
    {
        let clonedState : any = cloneDeepWith(this.state, (value) => {
            
            if(moment.isMoment(value)) {
                let v = value
                return v.clone()
            }

            if(value instanceof Date) {
                return new Date(value.getTime())
            }
            
            return
        })

        return clonedState
    }

    /**
     * @deprecated use nextState
     */
    public newState() : T
    {
        return this.nextState()
    }

    /**
     * Return the next state (this is a WIP state that has not been sent to listeners)
     */
    public nextState() : T
    {
        if(this._nextState)
        {
            return this._nextState
        }

        return this._nextState = this.cloneState()
    }

    /**
     * Sends notification of state to given listeners
     */
    protected notify(oldState : T)
    {
        if(this.debug) {
            console.debug('Store state changed, notifying ' + this.listeners.length + ' listener(s) of change', 'Old State', oldState, 'New State', this.state)
        }

        this.listeners.forEach((listener) => {
            listener(this.state, oldState)
        })

        this.dirtyState = false
    }
    
    /**
     * Insert an item into the given modelArray, update it if it already exists
     */
    public upsertItem(modelArray : any[], keyValue : any, newItem : any, overwrite : boolean = false) : boolean
    {
        var updated : boolean = false
        
        if(typeof modelArray === 'undefined' || !Array.isArray(modelArray)) {
            console.warn('Non array passed in as modelArray')
            modelArray = []
        }

        if(typeof newItem !== 'object') {
            console.warn('Upserted item must be an object', typeof newItem, 'given')
            return false
        }

        if(typeof newItem['__bID'] !== 'undefined' && newItem['__bID'] !== keyValue) {
            console.warn('Upserted item does not match the keyValue passed in', newItem['__bID'], '!=', keyValue)
            return false
        }

        let existing = null
        for(var i = 0; i < modelArray.length; i++) {
            let item = modelArray[i]
            if(item['__bID'] === keyValue) {
                existing = i
                break
            }
        }
        
        if(existing === null) {
            newItem['__bID'] = keyValue
            modelArray.push(newItem)
        } else {
            let existingItem = modelArray[existing]
            modelArray[existing] = overwrite ? newItem : this.merge(existingItem, newItem)
            modelArray[existing]['__bID'] = keyValue
        }

        return true
    }

    /**
     * Get an item from a modelArray
     */
    public getItem(modelArray : any[], keyValue : any) : any
    {
        let existing = null
        for(var i = 0; i < modelArray.length; i++) {
            let item = modelArray[i]
            if(item['__bID'] === keyValue) {
                return item
            }
        }

        return null
    }
    
    /**
     * Remove an item from a modelArray
     */
    public removeItem(modelArray : any[], keyValue : any) : any[]|boolean
    {
        let existing = null
        for(var i = 0; i < modelArray.length; i++) {
            let item = modelArray[i]
            if(item['__bID'] === keyValue) {
                existing = i
                break
            }
        }

        if(existing === null) {
            return false
        }
        
        return modelArray.splice(existing, 1)
    }
    
    /**
     * Pass in an array of keyValues and remove all items that match
     */
    public removeItems(modelArray : any[], keyValues : any[]) 
    {
        keyValues.forEach((keyValue) => {
            this.removeItem(modelArray, keyValue)
        })
    }
    
    /**
     * Sanitize and valide the given object to the given schema
     */
    public sanitizeAndValidate(obj : any, schema : any)
    {
        var model = this.sanitize(obj, schema, false)
        var validation = this.validate(model, schema)

        if(validation === true) {
            return model
        }
        
        return validation
    }
    
    /**
     * Validate the given object to the given schema, will return an array
     * of errors, or true if valid
     */
    public validate(obj : any, schema : any) : any[]|boolean
    {
        var errors : string[] = []
        
        for(var field in schema) {
            if(typeof(schema[field].validation) !== 'undefined') {
                for(var validation in schema[field].validation) {
                    if(errors.length > 0) {
                        break
                    }
                    var value = obj[field]
                    let validationParameters = schema[field].validation[validation]

                    //validate sub objects if marked as should validate
                    if(schema[field].type === 'object' && validation === 'validate' && validationParameters) {
                        let subErrors = this.validate(value, schema[field].schema())
                        if(subErrors !== true) {
                            errors = errors.concat(subErrors as string[])
                            break
                        }
                    }
                    
                    var label = schema[field].label ? schema[field].label : field
                    
                    switch(validation) {
                        case 'required':
                            if(typeof(value) === 'undefined' || value === null || value === '') {
                                errors.push(label + ' is required')
                            }
                        break
                        case 'minLength':
                            if(value.length < validationParameters) {
                                errors.push(label + ' must be at least ' + validationParameters + ' characters')
                            }
                        break
                        case 'maxLength':
                            if(value.length > validationParameters) {
                                errors.push(label + ' must be at under ' + validationParameters + ' characters')
                            }
                        break
                        default:
                            if(typeof(validationParameters) === 'function') {
                                var results = validationParameters(value)
                                if(results !== true) {
                                    errors = errors.concat(results)
                                }
                            }
                        break
                        
                    }
                }
            }
        }
        
        return errors.length > 0 ? errors : true
    }
    
    /**
     * Sanitize the given object to a schema, also an optional parameter if
     * you are sending the object as JSON, to format datetimes properly
     */
    public sanitize(obj : any, schema : any, json : boolean = false) : any
    {
        var clean = {}
        var tmp = extend(true, {}, obj)
        for(var field in schema) {
            clean[field] = this.sanitizeField(field, schema, json, tmp)
        }
            
        return clean
    }
    
    /**
     * Merge objects together
     */
    public merge(obj1 : any, obj2 : any) 
    {
        merge(obj1, obj2)

        return obj1
    }
    
    /**
     * Creates a filter sort callback to sort by a given key
     */
    public sortBy(key : string, dir : string = 'desc')
    {
        return (a, b) => {

            if((b[key] && !a[key]) || (b[key] && a[key] && b[key] > a[key])) {
                return dir.toLowerCase() === 'desc' ? 1 : -1
            }

            if((!b[key] && a[key]) || (b[key] && a[key] && b[key] < a[key])) {
                return dir.toLowerCase() === 'desc' ? -1 : 1
            }

            if(b[key] && a[key] && b[key] == a[key]) {
                return 0
            }

            if(b[key] && !a[key]) {
                return 0
            }
        }
    }
    
    /**
     * Formats a given number to two decimal places
     */
    public money(value : number)
    {
        return value.toFixed(2)
    }
    
    public static string(params = {}) 
    {
        return extend(true, {
            type: 'string',
            initial: () => ''
        }, params)
    }
    
    public static int(params = {}) 
    {
        return extend(true, {
            type: 'int',
            initial: () => 0
        }, params)
    }
    
    public static double(params = {}) 
    {
        return extend(true, {
            type: 'double',
            initial: () => 0
        }, params)
    }
    public static bool(params = {}) 
    {
        return extend(true, {
            type: 'bool',
            initial: () => false
        }, params)
    }
    
    public static float(params = {}) 
    {
        return extend(true, {
            type: 'float',
            initial: () => 0
        }, params)
    }
    
    public static array (params = {}) 
    {
        return extend(true, {
            type: 'array',
            schema: null,
            initial: () => []
        }, params)
    }
    public static object (params = {}) 
    {
        return extend(true, {
            type: 'object',
            schema: null,
            initial: () => { return {} }
        }, params)
    }
    
    public static datetime (params = {}) 
    {
        return extend(true, {
            type: 'datetime',
            schema: null,
            format: 'YYYY-MM-DD HH:mm:ss',
            initial: () => null
        }, params)
    }

    public static callback(params = {}) 
    {
        return extend(true, {
            type: 'callback',
            schema: null,
            initial: () => null
        }, params)
    }

    public static customType(type, params = {}) 
    {
        return extend(true, {
            type: type,
            schema: null,
            initial: () => null
        }, params)
    }
    
    /**
     * Sanitizes a field on an object to the given schema
     */
    protected sanitizeField(field : string, schema : any, json : boolean, obj : any,)
    {
        if(schema[field].type === 'function') {
            return schema[field].value //return function
        }

        if(typeof(obj[field]) === 'undefined') {
            //see if schema has a default
            if(typeof(schema[field]['initial']) !== 'undefined') {
                obj[field] = schema[field]['initial']()
            } else {
                obj[field] = null
            }
        }
        var type = schema[field]['type']
        if(obj[field] === null && type !== 'obj' && type !== 'object') {
            return null
        }

        schema[field].field = field

        switch(type) {
            case 'int':
            case 'integer':
                return this.sanitizeInteger(obj[field], schema[field])
            case 'float':
            case 'double':
                return this.sanitizeFloat(obj[field], schema[field])
            case 'string':
            case 'char':
            case 'varchar':
                return this.sanitizeString(obj[field], schema[field])
            case 'date':
            case 'datetime':
            case 'timestamp':
                return this.sanitizeDateTime(obj[field], schema[field], json)
            case 'bool':
            case 'boolean':
                return this.sanitizeBoolean(obj[field], schema[field])
            case 'obj':
            case 'object':
                return this.sanitizeObject(obj[field], schema[field], json)
            case 'array':
            case 'collection':
                return this.sanitizeArray(obj[field], schema[field], json)
            case 'callback':
                return this.sanitizeCallback(obj[field], schema[field])
            default:
                if(typeof schema[field].sanitize !== 'undefined') {
                    return schema[field].sanitize(obj[field], schema[field])
                }
                break
        }
    }

    protected sanitizeCallback(value : any, schemaConfig : any)
    {
        if(typeof value !== 'function') {
            throw new Error('Provided callback is not a valid function')
        }

        return value
    }
    
    /**
     * Sanitizes a field to an integer
     */
    protected sanitizeInteger(value : any, schemaConfig : any)
    {
        if(typeof value === 'string') {
            value = value.replace(/[a-zA-Z]+/gi, '')
            if(value.length === 0) {
                return value = ''
            }
        }

        value = parseInt(value)

        if(typeof(schemaConfig.min) !== 'undefined' && value < schemaConfig.min) {
            throw new Error('Provided value cannot be sanitized, value is below minimum integer allowed')
        }
        if(typeof(schemaConfig.max) !== 'undefined' && value > schemaConfig.max) {
            throw new Error('Provided value cannot be sanitized, value is greater than maximum integer allowed')
        }

        if(isNaN(value)) {
            return value = ''
        }

        return value
    }
    
    /**
     * Sanitizes a field to a float
     */
    protected sanitizeFloat(value : any, schemaConfig : any)
    {
        value = parseFloat(value)
        if(typeof(schemaConfig.min) !== 'undefined' && value < schemaConfig.min) {
            throw new Error('Provided value cannot be sanitized, value is below minimum float allowed')
        }

        if(typeof(schemaConfig.max) !== 'undefined' && value > schemaConfig.max) {
            throw new Error('Provided value cannot be sanitized, value is greater than maximum float allowed')
        }

        return value
    }
    
    /**
     * Sanitizes a field to a string
     */
    protected sanitizeString(value : any, schemaConfig : any)
    {
        value = String(value)
        if(typeof(schemaConfig.minLength) !== 'undefined' && value.length < schemaConfig.minLength) {
            throw new Error('Provided value cannot be sanitized, string length is below minimum allowed')
        }

        if(typeof(schemaConfig.maxLength) !== 'undefined' && value.length > schemaConfig.maxLength) {
            //truncate and do a warning
            console.warn('Value was truncated during sanitization')
            value = value.substr(0, schemaConfig.maxLength)
        }

        return value
    }
    
    /**
     * Sanitizes a field to a moment object
     */
    protected sanitizeDateTime(value : any, schemaConfig : any, json : boolean) : any
    {
        if(typeof schemaConfig.utc === 'undefined' || schemaConfig.utc) {
            var momentDate = moment.utc(value, schemaConfig.format)
        } else {
            var momentDate = moment(value, schemaConfig.format)
        }

        if(momentDate.isValid()) {
            if(json) {
                return momentDate.utc().format('YYYY-MM-DD hh:mm:ss')
            }

            return momentDate
        }

        throw new Error("Provided value ("+ value +") cannot be sanitized for field ("+ schemaConfig.field +"), is not a valid date")
    }
    
    /**
     * Sanitizes a field to boolean
     */
    protected sanitizeBoolean(value : any, schemaConfig : any)
    {
        if(value === false || value === true) {
            return value
        }

        if(typeof(value) == 'string') {

            if(value.toLowerCase().trim() === 'false') {
                return false
            }

            if(value.toLowerCase().trim() === 'true') {
                return true
            }
        }

        if(parseInt(value) === 0) {
            return false
        }

        if(parseInt(value) === 1) {
            return true
        }

        throw new Error('Provided value cannot be santized, is not a valid boolean')
    }
    
    /**
     * Sanitizes an object
     */
    protected sanitizeObject(value : any, schemaConfig : any, json : boolean)
    {
        if(typeof(schemaConfig.schema) === 'undefined') {
            throw new Error('Provided value cannot be santized, no reference schema provided for field type of object')
        }

        if(schemaConfig.schema === null) {
            return value
        }

        if(value === null) {
            return null
        }

        if(!json && typeof schemaConfig.constructor === 'function') {
            return new schemaConfig.constructor(this.sanitize(value, schemaConfig.schema()))
        }

        return this.sanitize(value, schemaConfig.schema(), json)
    }
    
    /**
     * Sanitizes an array of objects
     */
    protected sanitizeArray(value : any, schemaConfig : any, json : boolean)
    {
        if(typeof schemaConfig.memberType !== 'undefined') {
            if(!Array.isArray(value)) {
                return []
            }

            return value.map((v) => {
                return this.sanitizeField('member', {
                    member: extend(true, {
                        type: schemaConfig.memberType,
                        schema: null
                    }, schemaConfig.memberTypeConfig ? schemaConfig.memberTypeConfig : {})
                }, json, {
                    member: v
                })
            })
        }

        if(!Array.isArray(value)) {
            return []
        }

        if(typeof(schemaConfig.schema) === 'undefined' || schemaConfig.schema === null || schemaConfig.schema === false) {
            return value
        }

        return value.map((v) => {
            if(!json && typeof schemaConfig.constructor === 'function') {
                return new schemaConfig.constructor(this.sanitize(v, schemaConfig.schema()))
            }
            return this.sanitize(v, schemaConfig.schema(), json)
        })
    }

    __onSeed(rawState : Partial<T>) : T
    {
        if(typeof this.__seedFunctions !== 'undefined') {
            this.__seedFunctions.forEach((seed) => {
                this[seed.method](seed.cb(rawState))
            })
        }
        
        return this.nextState()
    }
}

export default Store