# Alterações no HPB meet04 — para atualizar o script de provisionamento

**Contexto:** o servidor foi provisionado por script, mas faltavam configurações e
adicionamos recursos novos. Este documento lista tudo que mexemos, para incorporar
ao script de setup. Use variáveis: `IP_PUBLICO` (ex.: 187.0.5.165),
`HOST_WEB` (ex.: meet04.avuz.app), `HOST_TURN` (ex.: turn04.avuz.app).

Validado em produção 30/07/2026 (chamada real: ~8% de carga, 95% CPU ociosa, zero
perda de pacotes — folga de ~10×). Detalhes técnicos e troubleshooting em
[`talk-hpb-troubleshooting.md`](talk-hpb-troubleshooting.md).

---

## 1. Janus — estava SEM configurar (falha do script)

O script instalou o Janus mas deixou as chaves de rede comentadas (placeholder
`1.2.3.4`). **Sem isso as chamadas entram em loop de reconexão.**

Em `/usr/etc/janus/janus.jcfg` (seção `nat`):
```
full_trickle = true
nat_1_1_mapping = "IP_PUBLICO"
rtp_port_range = "20000-40000"
```
Depois: `systemctl restart janus`

## 2. Tuning de rede (UDP) — estava no padrão

O script não ajustava os buffers de UDP (essenciais para WebRTC). Criar
`/etc/sysctl.d/99-nextcloud-hpb.conf`:
```
net.core.rmem_max = 33554432
net.core.wmem_max = 33554432
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.core.netdev_max_backlog = 5000
net.core.somaxconn = 65535
net.ipv4.udp_mem = 131072 262144 524288
net.ipv4.udp_rmem_min = 16384
net.ipv4.udp_wmem_min = 16384
```
Depois: `sysctl -p /etc/sysctl.d/99-nextcloud-hpb.conf`

## 3. TURN na porta 443 (recurso NOVO — clientes em redes restritas)

Permite que usuários atrás de firewall corporativo (que só liberam 443) conectem.
Usa multiplexação por SNI no nginx (sem precisar de 2º IP).

**Pré-requisitos manuais por deploy** (não automatizáveis no script):
- DNS: `HOST_TURN` → `IP_PUBLICO`, **cinza (sem proxy Cloudflare)**
- Certificado: `certbot certonly --webroot -w /var/www/html -d HOST_TURN`

**No script:**

a) Módulo de stream do nginx:
```
apt-get install -y libnginx-mod-stream
```

b) Mover o vhost web da 443 pública para porta interna (no site do nginx):
```
listen 127.0.0.1:8443 ssl;   # antes: listen 443 ssl;
listen [::1]:8443 ssl;       # antes: listen [::]:443 ssl;
```

c) Adicionar o bloco `stream` no topo do `/etc/nginx/nginx.conf` (fora do `http{}`):
```
stream {
    map $ssl_preread_server_name $hpb_upstream {
        HOST_TURN  127.0.0.1:5349;
        default    127.0.0.1:8443;
    }
    server { listen 443; listen [::]:443; proxy_pass $hpb_upstream; ssl_preread on; }
}
```

d) coTURN usar o certificado do `HOST_TURN` (em `/etc/turnserver.conf`):
```
cert=/etc/letsencrypt/live/HOST_TURN/fullchain.pem
pkey=/etc/letsencrypt/live/HOST_TURN/privkey.pem
```
> **Importante:** o coTURN apresenta **um único certificado**, então TODAS as URLs
> TLS dele (5349 e 443) precisam usar `HOST_TURN`.

e) Sinalização (`/etc/nextcloud-spreed-signaling/server.conf`, seção `[turn]`):
```
servers = turn:HOST_TURN:3478,turns:HOST_TURN:5349,turns:HOST_TURN:443?transport=tcp
```

f) Aplicar:
```
nginx -t && systemctl reload nginx && systemctl restart coturn nextcloud-spreed-signaling
```

**Passo manual no painel do Nextcloud** (Talk → Servidores TURN), o **mesmo segredo**
do coTURN (`static-auth-secret`) nas 3 linhas:
- `turn:HOST_TURN:3478` — UDP e TCP
- `turns:HOST_TURN:5349` — UDP e TCP
- `turns:HOST_TURN:443` — **TCP apenas**

Verificação (server-side, sem precisar de rede restrita):
```
# SNI turn04 na 443 deve mostrar CN=HOST_TURN; SNI meet04 deve mostrar CN=HOST_WEB
for sni in HOST_TURN HOST_WEB; do echo -n "$sni → "; \
  echo | openssl s_client -connect HOST_WEB:443 -servername $sni 2>/dev/null \
  | openssl x509 -noout -subject; done
```

## 4. Monitoramento (NOVO)

Arquivos versionados no repo (`scripts/` + `docs/runbooks/talk-hpb-troubleshooting.md`):
- `scripts/hpb-health.sh` — checagem de saúde sob demanda (serviços, welcome,
  `nat_1_1`, certificados, carga, disco, perda de UDP).
- `scripts/hpb-monitor.sh` — “caixa-preta”: grava métricas a cada 60s em
  `/var/log/hpb/`, apaga sozinho após 14 dias (~1 MB no total).

Instalar como systemd (ver bloco em `talk-hpb-troubleshooting.md` → *Install the
monitoring*): `hpb-monitor.service` + `hpb-health.timer`.

## 5. Resiliência (recomendado adicionar ao script)

a) Reload do nginx após renovar certificado (senão o TLS quebra em ~90 dias):
```
# /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
#!/bin/bash
systemctl reload nginx
```

b) nginx reinicia sozinho se cair:
```
# /etc/systemd/system/nginx.service.d/restart.conf
[Service]
Restart=on-failure
RestartSec=5s
```

## 6. Cuidados / lições (NÃO fazer)

- **NÃO adicionar `denied-peer-ip` no coTURN.** Testamos: **quebra o teste de TURN
  do painel do Nextcloud** (o teste faz relay para o IP local do navegador do admin,
  que fica bloqueado) — deixa o painel vermelho. Não afeta chamadas reais, e o ganho
  de segurança é marginal num HPB dedicado (sem metadata de nuvem; coTURN já bloqueia
  loopback por padrão). Removemos.
- **Governador de CPU:** deixar em `schedutil` (padrão). `performance` gasta mais
  energia com ganho irrelevante. Não mexer.

## 7. Passos manuais por deploy (fora do script)

- Registro DNS do `HOST_TURN` (cinza, sem proxy).
- Emissão do certificado do `HOST_TURN`.
- Configuração TURN/STUN no painel do Nextcloud de cada instância.
- Apontar cada Nextcloud para o HPB (URL de sinalização + segredo do backend).

---

## Checklist rápido “HPB pronto”

- [ ] Hardware ≥4 núcleos + **AES-NI** + ≥8 GB (ideal: bare metal)
- [ ] Janus: `full_trickle`, `nat_1_1_mapping`, `rtp_port_range` (item 1)
- [ ] Buffers UDP ajustados e persistidos (item 2)
- [ ] TURN 443 via SNI mux, se houver clientes em rede restrita (item 3)
- [ ] Segredo do coTURN == sinalização == painel NC (mesmo valor)
- [ ] Monitoramento rodando (item 4)
- [ ] Reload de cert + `Restart=on-failure` no nginx (item 5)
- [ ] SEM `denied-peer-ip` (item 6)
