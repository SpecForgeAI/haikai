package com.example.jiraservice.config;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Configuration for the REST client used to communicate with Jira Cloud.
 *
 * <p>Creates a {@link RestClient} bean configured with:</p>
 * <ul>
 *     <li>Base URL from {@link JiraProperties#baseUrl()}</li>
 *     <li>Connect and read timeouts from JiraProperties</li>
 *     <li>Authorization header based on the configured {@link JiraProperties.AuthMode}</li>
 *     <li>Default Accept: application/json header</li>
 * </ul>
 *
 * <p>Follows the RestClientConfig pattern from architecture-read-service.</p>
 */
@Configuration
public class JiraRestClientConfig {

    private final JiraProperties jiraProperties;

    public JiraRestClientConfig(JiraProperties jiraProperties) {
        this.jiraProperties = jiraProperties;
    }

    /**
     * Creates a RestClient configured for Jira Cloud REST API calls.
     *
     * @return configured RestClient instance for Jira API communication
     */
    @Bean
    @Qualifier("jiraRestClient")
    public RestClient jiraRestClient() {
        SimpleClientHttpRequestFactory requestFactory = createRequestFactory();

        RestClient.Builder builder = RestClient.builder()
            .baseUrl(jiraProperties.baseUrl())
            .requestFactory(requestFactory)
            .defaultHeader("Accept", "application/json");

        addAuthenticationHeader(builder);

        return builder.build();
    }

    private SimpleClientHttpRequestFactory createRequestFactory() {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(jiraProperties.connectTimeoutMs());
        requestFactory.setReadTimeout(jiraProperties.readTimeoutMs());
        return requestFactory;
    }

    /**
     * Adds the appropriate Authorization header based on the configured auth mode.
     *
     * <p>BEARER mode sets {@code Authorization: Bearer <bearerToken>}.
     * BASIC mode sets {@code Authorization: Basic <base64(username:apiToken)>}.</p>
     */
    private void addAuthenticationHeader(RestClient.Builder builder) {
        switch (jiraProperties.authMode()) {
            case BEARER -> {
                if (jiraProperties.bearerToken() != null) {
                    builder.defaultHeader("Authorization", "Bearer " + jiraProperties.bearerToken());
                }
            }
            case BASIC -> {
                if (jiraProperties.username() != null && jiraProperties.apiToken() != null) {
                    String credentials = jiraProperties.username() + ":" + jiraProperties.apiToken();
                    String encodedCredentials = Base64.getEncoder()
                        .encodeToString(credentials.getBytes(StandardCharsets.UTF_8));
                    builder.defaultHeader("Authorization", "Basic " + encodedCredentials);
                }
            }
        }
    }
}
