package com.example.archtool.config;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Configuration for REST client used to communicate with Confluence.
 *
 * <p>Configures a single RestClient bean for all Confluence HTTP calls:</p>
 * <ul>
 *     <li>{@code confluenceApiRestClient} - For all Confluence API calls including attachment downloads</li>
 * </ul>
 *
 * <p>The client is configured with authentication and timeouts from {@link ConfluenceProperties}.</p>
 */
@Configuration
public class RestClientConfig {

    private final ConfluenceProperties confluenceProperties;

    public RestClientConfig(ConfluenceProperties confluenceProperties) {
        this.confluenceProperties = confluenceProperties;
    }

    /**
     * Creates a RestClient configured for Confluence REST API calls.
     *
     * <p>Uses {@code apiBaseUrl} as base URL and sets {@code Accept: application/json}
     * header for JSON API responses. This single client is used for all Confluence
     * communication including attachment downloads via the REST API endpoint.</p>
     *
     * @return configured RestClient instance for all Confluence calls
     */
    @Bean
    @Qualifier("confluenceApiRestClient")
    public RestClient confluenceApiRestClient() {
        SimpleClientHttpRequestFactory requestFactory = createRequestFactory();

        RestClient.Builder builder = RestClient.builder()
            .baseUrl(confluenceProperties.apiBaseUrl())
            .requestFactory(requestFactory)
            .defaultHeader("Accept", "application/json");

        addAuthenticationHeader(builder);

        return builder.build();
    }

    private SimpleClientHttpRequestFactory createRequestFactory() {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(confluenceProperties.connectTimeoutMs());
        requestFactory.setReadTimeout(confluenceProperties.readTimeoutMs());
        return requestFactory;
    }

    private void addAuthenticationHeader(RestClient.Builder builder) {
        if (confluenceProperties.username() != null && confluenceProperties.apiToken() != null) {
            String credentials = confluenceProperties.username() + ":" + confluenceProperties.apiToken();
            String encodedCredentials = Base64.getEncoder()
                .encodeToString(credentials.getBytes(StandardCharsets.UTF_8));
            builder.defaultHeader("Authorization", "Basic " + encodedCredentials);
        }
    }
}
