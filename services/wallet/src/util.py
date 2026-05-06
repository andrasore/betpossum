import socket

def resolve_to_ip(host: str):
    hostname, _, port = host.partition(":")
    try:
        socket.inet_aton(hostname)
        ip = hostname
    except socket.error:
        ip = socket.gethostbyname(hostname)
    return f"{ip}:{port}" if port else ip
