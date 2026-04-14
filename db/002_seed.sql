INSERT INTO venues (id, "name", former_names, address, lat, lng, closed)
VALUES ('v0001','Wembley Stadium','{}','Wembley HA9 0WS, United Kingdom',51.55625814376759, -0.27959624532223176,false),
       ('v0002','Mynavi Blitz Akasaka','{Akasaka Blitz}','Akasaka-Sacas, 5-3-2 Akasaka 5-3-2, Minato, Tokyo, Japan',35.672833787010475, 139.7351265694772,true),
       ('v0003','Hollywood Pantages Theatre','{Pantages Theatre}','6233 Hollywood Blvd, Los Angeles, CA 90028, United States',34.10190914136075, -118.32561205322247,false)
    ON CONFLICT (id) DO NOTHING;

INSERT INTO events (id, "type", venue_id, dates, artists, setlist_fm_url, last_fm_url, notes, festival_name)
VALUES  ('e0001','gig','v0001','{''1986-07-12''}','{Queen, Status Quo, The Alarm, INXS}','','','',''),
        ('e0002','gig','v0002','{''1998-12-28''}','{Fishmans}','','','',''),
        ('e0003','gig','v0003','{''1983-12-13''}','{Talking Heads}','','','','')
    ON CONFLICT (id) DO NOTHING;