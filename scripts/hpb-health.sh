#!/bin/bash
# HPB health snapshot — run when a call-quality complaint lands. A green final
# line means the server is ruled out; triage the client (see
# docs/runbooks/talk-hpb-troubleshooting.md). Read-only. Override DOMAIN/IP for
# a different HPB.
DOMAIN="${DOMAIN:-meet04.avuz.app}"; IP="${IP:-187.0.5.165}"; CORES=$(nproc); OK=1
red(){ echo "  ✗ $*"; OK=0; }; grn(){ echo "  ✓ $*"; }
echo "=== HPB health $DOMAIN $(date '+%F %T') ==="
for s in nextcloud-spreed-signaling nats-server nginx janus coturn; do
  systemctl is-active --quiet "$s" && grn "$s up" || red "$s DOWN"; done
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/standalone-signaling/api/v1/welcome")
[ "$code" = 200 ] && grn "signaling welcome 200" || red "welcome=$code"
grep -q "nat_1_1_mapping = \"$IP\"" /usr/etc/janus/janus.jcfg 2>/dev/null \
  && grn "janus nat_1_1 ok" || red "janus nat_1_1 WRONG/missing → calls drop-loop"
exp=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN":443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$exp" ]; then days=$(( ( $(date -d "$exp" +%s) - $(date +%s) ) / 86400 ))
  [ "$days" -gt 7 ] && grn "cert ${days}d left" || red "cert expires in ${days}d"; else red "cert unreadable"; fi
load=$(cut -d' ' -f1 /proc/loadavg)
[ "$(awk "BEGIN{print ($load>$CORES*0.6)?1:0}")" = 0 ] && grn "load $load / $CORES cores" || red "load $load HIGH for $CORES cores"
idle=$(top -bn2 -d1 | awk '/%Cpu/{v=$8} END{print int(v)}')
[ "$idle" -gt 40 ] && grn "cpu idle ${idle}%" || red "cpu idle only ${idle}%"
diskpct=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$diskpct" -lt 90 ] && grn "disk ${diskpct}% used" || red "disk ${diskpct}% FULL (crash risk)"
grn "mem $(free -m | awk '/Mem/{print $7}')MB available"
u0=$(awk '/^Udp:/{c++;if(c==2)print $6}' /proc/net/snmp); sleep 3
u1=$(awk '/^Udp:/{c++;if(c==2)print $6}' /proc/net/snmp)
[ $((u1-u0)) -eq 0 ] && grn "UDP rcvbuf drops 0/3s" || red "UDP drops $((u1-u0))/3s (buffer pressure)"
echo "  · ~$(journalctl -u nextcloud-spreed-signaling --since '-2min' 2>/dev/null | grep -c Register) registrations last 2min (rough active load)"
echo "-----"
[ "$OK" = 1 ] && echo "SERVER HEALTHY → complaint is client-side (their net / hardware / browser)." \
             || echo "SERVER ISSUE ABOVE → fix before blaming the client."
