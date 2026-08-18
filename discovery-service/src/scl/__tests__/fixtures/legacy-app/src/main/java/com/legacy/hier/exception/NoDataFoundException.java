package com.legacy.hier.exception;

public class NoDataFoundException extends Exception {

    private final String businessDate;

    public NoDataFoundException(String message, String businessDate) {
        super(message);
        this.businessDate = businessDate;
    }

    public String getBusinessDate() {
        return businessDate;
    }
}
