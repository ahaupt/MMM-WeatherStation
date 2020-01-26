#!/usr/bin/perl

use HTTP::Request;
use LWP::UserAgent;
use LockFile::Simple qw(trylock unlock);
use JSON;
use DBI;
use DateTime;

$URL		= 'http://raspi3:8081';
$SQLITE_FILE 	= '/dev/shm/mmm-weatherstation.sqlite';
$LOCK_FILE 	= '/dev/shm/mmm-getdata';
$TABLE_NAME	= 'weatherdata';

trylock($LOCK_FILE) or exit 1;

$request = HTTP::Request->new('GET' => $URL);
$ua = LWP::UserAgent->new();
$ua->timeout(1.0);
$response = $ua->request($request);
die $response->status_line() unless $response->is_success();
$data = from_json($response->content(), { utf8 => 1 });

my $dbh = sqlite_db();
safe_data($dbh, $data);
my $minmax = get_minmax($dbh);

$output = {
	'air-pressure'		=> $data->{'air-pressure'},
	'air-pressure-1hour'	=> $minmax->{'air-pressure-1hour'},
	'indoor-humidity'	=> $data->{'indoor-humidity'},
	'indoor-humidity-min'	=> $minmax->{'indoor-humi-min'},
	'indoor-humidity-max'	=> $minmax->{'indoor-humi-max'},
	'indoor-celcius'	=> $data->{'indoor-temperature'},
	'indoor-fahrenheit'	=> to_fahrenheit($data->{'indoor-temperature'}),
	'indoor-kelvin'		=> to_kelvin($data->{'indoor-temperature'}),
	'indoor-celcius-min'	=> $minmax->{'indoor-temp-min'},
	'indoor-fahrenheit-min'	=> to_fahrenheit($minmax->{'indoor-temp-min'}),
	'indoor-kelvin-min'	=> to_kelvin($minmax->{'indoor-temp-min'}),
	'indoor-celcius-max'	=> $minmax->{'indoor-temp-max'},
	'indoor-fahrenheit-max'	=> to_fahrenheit($minmax->{'indoor-temp-max'}),
	'indoor-kelvin-max'	=> to_kelvin($minmax->{'indoor-temp-max'}),
	'indoor-dewpoint-celcius'=> dewpoint($data->{'indoor-temperature'}, $data->{'indoor-humidity'}),
	'outdoor-humidity'	=> $data->{'outdoor-humidity'},
	'outdoor-humidity-min'	=> $minmax->{'outdoor-humi-min'},
	'outdoor-humidity-max'	=> $minmax->{'outdoor-humi-max'},
	'outdoor-celcius'	=> $data->{'outdoor-temperature'},
	'outdoor-fahrenheit'	=> to_fahrenheit($data->{'outdoor-temperature'}),
	'outdoor-kelvin'	=> to_kelvin($data->{'outdoor-temperature'}),
	'outdoor-celcius-min'	=> $minmax->{'outdoor-temp-min'},
	'outdoor-fahrenheit-min'=> to_fahrenheit($minmax->{'outdoor-temp-min'}),
	'outdoor-kelvin-min'	=> to_kelvin($minmax->{'outdoor-temp-min'}),
	'outdoor-celcius-max'	=> $minmax->{'outdoor-temp-max'},
	'outdoor-fahrenheit-max'=> to_fahrenheit($minmax->{'outdoor-temp-max'}),
	'outdoor-kelvin-max'	=> to_kelvin($minmax->{'outdoor-temp-max'}),
	'outdoor-dewpoint-celcius'=> dewpoint($data->{'outdoor-temperature'}, $data->{'outdoor-humidity'}),
};
print encode_json($output), "\n";
unlock($LOCK_FILE);

sub sqlite_db {
    my $schema = "indoor_temp REAL, indoor_humi REAL, outdoor_temp REAL, outdoor_humi REAL, pressure REAL, time DATETIME DEFAULT CURRENT_TIMESTAMP";
    my $dbh = DBI->connect("dbi:SQLite:dbname=$SQLITE_FILE","","");
    $dbh->do("CREATE TABLE IF NOT EXISTS $TABLE_NAME ($schema)")
	or die $DBI::errstr;
    return $dbh;
}

sub safe_data {
    my ($dbh, $data) = @_;
    my $sth = $dbh->prepare("INSERT INTO $TABLE_NAME (indoor_temp, indoor_humi, outdoor_temp, outdoor_humi, pressure) VALUES (?,?,?,?,?)");
    $sth->execute(
	$data->{'indoor-temperature'},
	$data->{'indoor-humidity'},
	$data->{'outdoor-temperature'},
	$data->{'outdoor-humidity'},
	$data->{'air-pressure'}
    );
}

sub get_minmax {
    $dt = DateTime->now(time_zone => 'local');
    my $utc_offset = $dt->offset() * -1;
    my $to_utc = $utc_offset >= 0 ? '+' : '' . "\'$utc_offset seconds\'";
    my $dbh = shift();
    my $data = {};
    my ($row, $sth);
    my $clauses = { 
	'min_0' => "time > datetime(date('now', '-1 days'), '+18 hours', $to_utc)",
	'min_1' => "time > datetime(date('now', '-1 days'), '+18 hours', $to_utc)",
	'min_2' => "time > datetime(date('now'), '+18 hours', $to_utc)",
	'max_0' => "time > datetime(date('now', '-1 days'), '+6 hours', $to_utc)",
	'max_1' => "time > datetime(date('now'), '+6 hours', $to_utc)",
	'max_2' => "time > datetime(date('now'), '+6 hours', $to_utc)"
    };
    my @time = localtime();
    my $t = ($time[2] >= 0 && $time[2] < 6) ? 0 : ($time[2] < 18 ? 1 : 2);

#    use Dumpvalue;
#    my $d = new Dumpvalue;
    foreach my $kind ( qw(min max) ) {
	foreach my $sensor ( qw(temp humi) ) {
	    foreach my $inout ( qw(indoor outdoor) ) {
#		print qq(SELECT $kind(${inout}_${sensor}) FROM $TABLE_NAME WHERE $clauses->{"${kind}_$t"}), "\n";
		$sth = $dbh->prepare(qq(SELECT $kind(${inout}_${sensor}) FROM $TABLE_NAME WHERE $clauses->{"${kind}_$t"}));
		$sth->execute();
		$row = $sth->fetchrow_arrayref();
		$data->{"${inout}-${sensor}-${kind}"} = $row->[0];
	    }
	}
    }
    $sth = $dbh->prepare("SELECT pressure FROM weatherdata WHERE time < datetime(datetime('now'), '-1 hours') ORDER BY time DESC LIMIT 1");
    $sth->execute();
    $row = $sth->fetchrow_arrayref();
    $data->{"air-pressure-1hour"} = $row->[0];
#    $d->dumpValue($data);
    return $data;
}

sub to_kelvin {
    return sprintf("%.1f", shift() + 273.15);
}

sub to_fahrenheit {
    return sprintf("%.1f", shift() * 9 / 5 + 32);
}

sub log10 {
    return log(shift())/log(10);
}

sub dewpoint {
    my ($temp, $humi) = @_;
    my ($a, $b) = $temp > 0 ? (7.5, 237.3) : (7.6, 240.7);
    my $sdd = 6.1078 * exp(($a*$temp)/($b+$temp)/log10(exp(1)));
    my $dd = $humi * $sdd / 100;
    my $v = log10($dd/6.1078);
    return sprintf("%.1f", $b*$v / ($a-$v));
}
