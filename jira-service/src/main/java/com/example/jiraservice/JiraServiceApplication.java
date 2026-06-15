package com.example.jiraservice;

import com.example.jiraservice.config.JiraProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/**
 * Main application class for the Jira Service.
 *
 * <p>This Spring Boot application provides a REST API for querying Jira Cloud
 * via JQL and returning results mapped to WorkItemDto objects.</p>
 */
@SpringBootApplication
@EnableConfigurationProperties(JiraProperties.class)
public class JiraServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(JiraServiceApplication.class, args);
    }
}
