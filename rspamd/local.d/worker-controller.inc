# Port 11334 is only reachable inside the docker network (never published).
bind_socket = "*:11334";
secure_ip = ["127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
