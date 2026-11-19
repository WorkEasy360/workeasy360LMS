package com.workeasy360.backend;

import com.workeasy360.backend.sso.identity.Workeasy360Operator;
import java.util.Arrays;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BackendApplication {
    public static void main(String[] args) {
        // `java -jar backend.jar w360sso <command>`: an operator command (docs/workeasy360-sso.md), no web server.
        if (args.length > 0 && Workeasy360Operator.COMMAND.equals(args[0])) {
            System.exit(Workeasy360Operator.run(BackendApplication.class, Arrays.copyOfRange(args, 1, args.length)));
        }
        SpringApplication.run(BackendApplication.class, args);
    }
}
