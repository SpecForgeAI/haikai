package com.example.schemaapply;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * Spec X — Schema Apply Runner.
 *
 * <p>A minimal, headless Spring Boot application whose sole job is to apply a
 * generated DB migration pack's Liquibase changelog to a target database during
 * startup, then exit with a status code that reflects the outcome (0 = the
 * requested contexts have no unrun changesets left; non-zero = the apply
 * failed).</p>
 *
 * <p>The apply itself is performed by {@link SchemaApplyRunner} (an
 * {@code ApplicationRunner}), which fires as the context finishes starting —
 * i.e. Liquibase runs as the app boots, the way a real Spring target service
 * applies its schema. The runner is also an {@code ExitCodeGenerator}, so
 * {@link SpringApplication#exit} propagates its verdict to the process exit
 * code.</p>
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class SchemaApplyApplication {

    public static void main(String[] args) {
        ConfigurableApplicationContext context = new SpringApplicationBuilder(SchemaApplyApplication.class)
            .web(WebApplicationType.NONE)
            .run(args);
        // ApplicationRunner has already executed by the time run() returns; the
        // runner's ExitCodeGenerator carries the apply verdict.
        int exitCode = SpringApplication.exit(context);
        System.exit(exitCode);
    }
}
