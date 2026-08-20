#!/bin/bash
# HPB black-box recorder — always-on, 60s samples to a daily CSV, self-prunes
# after 14 days (~1MB total). Install as a systemd service (see
# docs/runbooks/talk-hpb-troubleshooting.md). When a complaint lands for "the
# 2pm call", grep the timestamp window: low load + 0 UDP drops = server was fine.
mkdir -p /var/log/hpb
while true; do
  F=/var/log/hpb/metrics-$(date +%F).csv
  [ -f "$F" ] || echo "t,load1,cpu_id,janus%,turn%,UdpRcvErrD,mem_mb,reg2min" > "$F"
  u0=$(awk '/^Udp:/{c++;if(c==2)print $6}' /proc/net/snmp)
  id=$(top -bn2 -d1 | awk '/%Cpu/{v=$8} END{print v}')
  read -r j t < <(top -bn1 | awk '/janus/{a+=$9}/turnserver/{b+=$9}END{printf "%.0f %.0f",a,b}')
  u1=$(awk '/^Udp:/{c++;if(c==2)print $6}' /proc/net/snmp)
  reg=$(journalctl -u nextcloud-spreed-signaling --since '-2min' 2>/dev/null | grep -c Register)
  echo "$(date +%T),$(cut -d' ' -f1 /proc/loadavg),$id,$j,$t,$((u1-u0)),$(free -m|awk '/Mem/{print $3}'),$reg" >> "$F"
  find /var/log/hpb -name 'metrics-*.csv' -mtime +14 -delete 2>/dev/null
  sleep 59
done
