///<reference path="../../typings/index.d.ts" />
import * as reqwest from "reqwest"
import { ReqwestOptions } from "reqwest"
import extend = require('extend')

/**
 * Wrapper to create a consistent sdk for doing XHR requests. Will
 * automatically replace matching variables in urls that match the pattern.
 * i.e/ /my/url/{someId}/ { someId: 1 } = /my/url/1/
 */
export class ApiServiceClass
{   
    public throttle(func : () => any, wait : number, immediate : boolean) 
    {
        var timeout;
        return function() {
            var context = this, args = arguments;
            var later = function() {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            var callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    }
    
    public get(url : string, data : any, config : ReqwestOptions = null)
    {
        return reqwest(this._buildConfig({
            url: this._buildUrl(url, data),
            method: 'get'
        }, config))
    }
    
    public post(url : string, data : any, config : ReqwestOptions = null)
    {
        return reqwest(this._buildConfig({
            url: this._buildUrl(url, data, false),
            method: 'post',
            data: JSON.stringify(data),
            contentType: 'application/json'
        }, config))
    }
    
    public put(url : string, data : any, config : ReqwestOptions = null)
    {
        return reqwest(this._buildConfig({
            url: this._buildUrl(url, data, false),
            method: 'put',
            data: JSON.stringify(data),
            contentType: 'application/json'
        }, config))
    }
    
    public ['delete'](url : string, data : any, config : ReqwestOptions = null)
    {
        return reqwest(this._buildConfig({
            url: this._buildUrl(url, data),
            method: 'delete'
        }, config))
    }
    
    
    protected _buildUrl(url : string, data : any, queryString : boolean = true) 
    {
        //build the url
        for(var i in data) {
            if(url.indexOf('{'+i+'}') !== -1){
                url = url.replace('{'+i+'}', data[i]);
                continue;
            }

            if(queryString === false){
                continue;
            }

            if(url.indexOf('?') !== -1){
                url += '&';
            } else {
                url += '?';
            }

            url += i + '=' + data[i];
        }

        return url;
    }

    protected _buildConfig(defaultConfig : any, customConfig : any = {}) : any
    {
        if(customConfig === null) {
            return defaultConfig
        }

        return extend(true, {}, defaultConfig, customConfig)
    }
}

let ApiService = new ApiServiceClass()

export
{
    ApiService
}