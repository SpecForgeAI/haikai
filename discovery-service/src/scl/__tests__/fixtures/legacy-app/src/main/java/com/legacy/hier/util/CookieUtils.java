package com.legacy.hier.util;

import javax.ws.rs.core.Cookie;
import javax.ws.rs.core.HttpHeaders;

public final class CookieUtils {

    private CookieUtils() {
    }

    public static String readSsoCookie(HttpHeaders headers) {
        Cookie cookie = headers.getCookies().get("SSO_TOKEN");
        return cookie == null ? null : cookie.getValue();
    }
}
