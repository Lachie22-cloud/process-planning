FROM postgres:16-alpine

# Build wal2json extension (for Supabase Realtime CDC)
RUN apk add --no-cache --virtual .build-deps git make gcc musl-dev clang19 llvm19-dev \
    && ln -sf /usr/bin/clang-19 /usr/bin/clang \
    && cd /tmp \
    && git clone --depth 1 https://github.com/eulerto/wal2json.git \
    && cd wal2json \
    && USE_PGXS=1 make \
    && USE_PGXS=1 make install \
    && cd / && rm -rf /tmp/wal2json \
    && apk del .build-deps

# Build pgsql-http extension (for Graph API calls from SQL)
RUN apk add --no-cache --virtual .build-deps git make gcc musl-dev curl-dev clang19 llvm19-dev \
    && ln -sf /usr/bin/clang-19 /usr/bin/clang \
    && cd /tmp \
    && git clone --depth 1 https://github.com/pramsey/pgsql-http.git \
    && cd pgsql-http \
    && make && make install \
    && cd / && rm -rf /tmp/pgsql-http \
    && apk del .build-deps

# Keep curl runtime lib for pgsql-http
RUN apk add --no-cache libcurl
