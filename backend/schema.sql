create table if not exists product_generations (
  id uuid primary key default gen_random_uuid(),

  batch_id text not null,
  csv_name text,
  product_id text not null,
  image_link text,

  prompt1 text,
  prompt2 text,
  prompt3 text,

  image1_path text,
  image2_path text,
  image3_path text,

  status1 text default 'PENDING',
  status2 text default 'PENDING',
  status3 text default 'PENDING',

  error1 text,
  error2 text,
  error3 text,

  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
