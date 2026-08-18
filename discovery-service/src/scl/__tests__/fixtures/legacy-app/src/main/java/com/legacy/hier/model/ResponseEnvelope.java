package com.legacy.hier.model;

import java.util.List;

import javax.xml.bind.annotation.XmlRootElement;

@XmlRootElement(name = "hierarchyViewResponse")
public class ResponseEnvelope {

    private String keyName;

    private String keyValue;

    private String userName;

    private ResponseCode responseCode;

    private String message;

    private List<HierarchyViewDetail> views;

    public String getKeyName() {
        return keyName;
    }

    public void setKeyName(String keyName) {
        this.keyName = keyName;
    }

    public String getKeyValue() {
        return keyValue;
    }

    public void setKeyValue(String keyValue) {
        this.keyValue = keyValue;
    }

    public String getUserName() {
        return userName;
    }

    public void setUserName(String userName) {
        this.userName = userName;
    }

    public ResponseCode getResponseCode() {
        return responseCode;
    }

    public void setResponseCode(ResponseCode responseCode) {
        this.responseCode = responseCode;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public List<HierarchyViewDetail> getViews() {
        return views;
    }

    public void setViews(List<HierarchyViewDetail> views) {
        this.views = views;
    }
}
