milter = yes;
timeout = 120s;
upstream "local" {
  default = yes;
  self_scan = yes;
}
count = 1;
bind_socket = "*:11332";
